import { createHmac } from "node:crypto";
import { CliError, ExitCode } from "../cli/errors.ts";

/**
 * TOTP handling, kept local so a code costs no extra `bw` spawn and can be
 * reported with the time it has left.
 *
 * Only shapes this module can compute *exactly* are computed here. Anything
 * else — a `steam://` secret, an unknown algorithm, a seed that will not decode
 * — is reported as unsupported so the caller can fall back to `bw get totp`.
 * A wrong six-digit code is indistinguishable from a right one until the login
 * fails, so guessing is never the safer option.
 */

/** RFC 4648 base32, minus the padding and separators authenticators sprinkle in. */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const STEAM_PREFIX = "steam://";

export const DEFAULT_PERIOD = 30;
export const DEFAULT_DIGITS = 6;
export const DEFAULT_ALGORITHM = "SHA1";

const SUPPORTED_ALGORITHMS: Record<string, string> = {
	SHA1: "sha1",
	SHA256: "sha256",
	SHA512: "sha512",
};

export interface TotpConfig {
	/** Normalized base32 secret, without padding or separators. */
	secret: string;
	period: number;
	digits: number;
	/** Uppercase name as it appears in an `otpauth://` URI. */
	algorithm: string;
}

export interface TotpCode {
	code: string;
	period: number;
	/** Whole seconds this code stays valid, counting the current one. */
	secondsRemaining: number;
}

/** Why a stored secret cannot be computed locally, for the fallback path. */
export class TotpUnsupportedError extends Error {}

/**
 * Reads a stored `login.totp` value. Bitwarden accepts a bare base32 secret, a
 * full `otpauth://` URI, or a `steam://` secret, and all three turn up in real
 * vaults.
 */
export function parseTotpSecret(raw: string): TotpConfig {
	const value = raw.trim();

	if (value.length === 0) {
		throw new TotpUnsupportedError("secret is empty");
	}

	if (value.toLowerCase().startsWith(STEAM_PREFIX)) {
		// Steam's alphabet and digit count differ from RFC 6238, and bwx has no
		// way to verify its output against a real Steam login.
		throw new TotpUnsupportedError("steam:// secrets are computed by bw");
	}

	const config = value.toLowerCase().startsWith("otpauth://")
		? parseOtpauthUri(value)
		: {
				secret: normalizeBase32(value),
				period: DEFAULT_PERIOD,
				digits: DEFAULT_DIGITS,
				algorithm: DEFAULT_ALGORITHM,
			};

	if (!(config.algorithm in SUPPORTED_ALGORITHMS)) {
		throw new TotpUnsupportedError(`unsupported algorithm ${config.algorithm}`);
	}

	if (!isBase32(config.secret)) {
		throw new TotpUnsupportedError("secret is not base32");
	}

	return config;
}

function parseOtpauthUri(value: string): TotpConfig {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new TotpUnsupportedError("otpauth URI does not parse");
	}

	if (url.host.toLowerCase() !== "totp") {
		throw new TotpUnsupportedError(`otpauth type "${url.host}" is not totp`);
	}

	const secret = url.searchParams.get("secret");
	if (!secret) throw new TotpUnsupportedError("otpauth URI has no secret");

	return {
		secret: normalizeBase32(secret),
		period: readPositiveInt(url, "period", DEFAULT_PERIOD),
		digits: readPositiveInt(url, "digits", DEFAULT_DIGITS),
		algorithm: (url.searchParams.get("algorithm") ?? DEFAULT_ALGORITHM).toUpperCase(),
	};
}

function readPositiveInt(url: URL, name: string, fallback: number): number {
	const raw = url.searchParams.get(name);
	if (raw === null) return fallback;

	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) {
		throw new TotpUnsupportedError(`otpauth ${name}="${raw}" is not a positive integer`);
	}
	return value;
}

/** Uppercases and drops the spaces, hyphens, and padding authenticators show. */
export function normalizeBase32(value: string): string {
	return value.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
}

function isBase32(value: string): boolean {
	return value.length > 0 && /^[A-Z2-7]+$/.test(value);
}

/**
 * Decodes base32 into bytes, discarding the trailing bits when the secret is not
 * a whole number of bytes. Real secrets do this — a 29-character seed carries
 * 145 bits and yields 18 bytes — and bw resolves them the same way, so rejecting
 * them or padding them out would produce codes that quietly disagree with bw's.
 */
export function base32Decode(value: string): Buffer {
	const bytes: number[] = [];
	let accumulator = 0;
	let bits = 0;

	for (const char of value) {
		const index = BASE32_ALPHABET.indexOf(char);
		if (index === -1) {
			throw new TotpUnsupportedError(`invalid base32 character "${char}"`);
		}

		accumulator = (accumulator << 5) | index;
		bits += 5;

		if (bits >= 8) {
			bits -= 8;
			bytes.push((accumulator >> bits) & 0xff);
		}
	}

	if (bytes.length === 0) {
		throw new TotpUnsupportedError("secret decodes to no bytes");
	}

	return Buffer.from(bytes);
}

/** Seconds left in the window `at` falls in, counting the current second. */
export function secondsRemaining(period: number, at: number = Date.now()): number {
	return period - (Math.floor(at / 1000) % period);
}

export function generateTotp(config: TotpConfig, at: number = Date.now()): TotpCode {
	const key = base32Decode(config.secret);
	const counter = Math.floor(at / 1000 / config.period);

	const message = Buffer.alloc(8);
	message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
	message.writeUInt32BE(counter >>> 0, 4);

	const digest = createHmac(SUPPORTED_ALGORITHMS[config.algorithm]!, key)
		.update(message)
		.digest();

	// RFC 6238 dynamic truncation: the low nibble of the last byte picks the
	// four-byte window, and the high bit is masked off to stay sign-agnostic.
	const offset = digest[digest.length - 1]! & 0x0f;
	const binary = digest.readUInt32BE(offset) & 0x7fffffff;

	return {
		code: String(binary % 10 ** config.digits).padStart(config.digits, "0"),
		period: config.period,
		secondsRemaining: secondsRemaining(config.period, at),
	};
}

/**
 * Validates a secret on its way *into* the vault. A seed is only ever exercised
 * at login, so a typo accepted here surfaces when the caller is already locked
 * out — the one moment they cannot fix it. Returns the value to store.
 */
export function normalizeTotpInput(raw: string): string {
	const value = raw.trim();

	if (value.length === 0) {
		throw new CliError("TOTP secret cannot be empty", ExitCode.BadArgs);
	}

	// Stored verbatim: bw owns these, and bwx would only mangle them.
	if (value.toLowerCase().startsWith(STEAM_PREFIX)) return value;

	if (value.toLowerCase().startsWith("otpauth://")) {
		try {
			parseTotpSecret(value);
		} catch (err) {
			throw new CliError(
				`Invalid otpauth URI: ${describe(err)}`,
				ExitCode.BadArgs,
			);
		}
		return value;
	}

	const secret = normalizeBase32(value);
	if (!isBase32(secret)) {
		throw new CliError(
			`Invalid TOTP secret: expected base32 (A-Z, 2-7) or an otpauth:// URI, got "${redact(value)}"`,
			ExitCode.BadArgs,
		);
	}

	// A secret shorter than a byte cannot key an HMAC.
	try {
		base32Decode(secret);
	} catch (err) {
		throw new CliError(`Invalid TOTP secret: ${describe(err)}`, ExitCode.BadArgs);
	}

	return secret;
}

/** Keeps a rejected secret out of logs while still showing what was wrong with it. */
function redact(value: string): string {
	const bad = value.replace(/[A-Za-z0-9\s=-]/g, "");
	if (bad.length > 0) return `…contains "${[...new Set(bad)].join("")}"`;
	return `…${value.length} characters`;
}

function describe(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
