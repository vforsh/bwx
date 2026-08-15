import { describe, expect, test } from "bun:test";
import {
	base32Decode,
	generateTotp,
	normalizeBase32,
	normalizeTotpInput,
	parseTotpSecret,
	secondsRemaining,
	TotpUnsupportedError,
	type TotpConfig,
} from "../src/bw/totp.ts";
import { CliError } from "../src/cli/errors.ts";

/** Local encoder so the RFC vectors below can be stated as their real ASCII keys. */
function base32Encode(input: string): string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	let bits = 0;
	let accumulator = 0;
	let out = "";

	for (const byte of Buffer.from(input)) {
		accumulator = (accumulator << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			out += alphabet[(accumulator >> bits) & 0x1f];
		}
	}
	if (bits > 0) out += alphabet[(accumulator << (5 - bits)) & 0x1f];

	return out;
}

const RFC_SHA1 = base32Encode("12345678901234567890");
const RFC_SHA256 = base32Encode("12345678901234567890123456789012");
const RFC_SHA512 = base32Encode(
	"1234567890123456789012345678901234567890123456789012345678901234",
);

function config(overrides: Partial<TotpConfig> = {}): TotpConfig {
	return {
		secret: RFC_SHA1,
		period: 30,
		digits: 8,
		algorithm: "SHA1",
		...overrides,
	};
}

describe("generateTotp — RFC 6238 vectors", () => {
	const cases: Array<[string, string, number, string]> = [
		["SHA1", RFC_SHA1, 59, "94287082"],
		["SHA1", RFC_SHA1, 1_111_111_109, "07081804"],
		["SHA1", RFC_SHA1, 1_111_111_111, "14050471"],
		["SHA1", RFC_SHA1, 1_234_567_890, "89005924"],
		["SHA1", RFC_SHA1, 2_000_000_000, "69279037"],
		["SHA1", RFC_SHA1, 20_000_000_000, "65353130"],
		["SHA256", RFC_SHA256, 59, "46119246"],
		["SHA256", RFC_SHA256, 1_111_111_109, "68084774"],
		["SHA512", RFC_SHA512, 59, "90693936"],
		["SHA512", RFC_SHA512, 1_111_111_109, "25091201"],
	];

	for (const [algorithm, secret, seconds, expected] of cases) {
		test(`${algorithm} at T=${seconds}`, () => {
			const result = generateTotp(
				config({ secret, algorithm }),
				seconds * 1000,
			);
			expect(result.code).toBe(expected);
		});
	}

	test("pads a code that lands below the digit count", () => {
		// 07081804 above already exercises this; assert the width contract directly.
		const result = generateTotp(config({ digits: 6 }), 1_111_111_109_000);
		expect(result.code).toHaveLength(6);
	});
});

describe("base32Decode", () => {
	test("decodes a whole-byte secret", () => {
		// 16 chars = 80 bits = 10 bytes, the common authenticator shape.
		expect(base32Decode("A".repeat(16))).toHaveLength(10);
	});

	test("discards the trailing bits of a secret that is not byte-aligned", () => {
		// 29 chars = 145 bits. Real vaults contain these, and bw truncates to 18
		// bytes rather than rejecting or padding — matching it is the whole point.
		expect(base32Decode("A".repeat(29))).toHaveLength(18);
	});

	test("rejects characters outside the alphabet", () => {
		expect(() => base32Decode("AAAA1AAA")).toThrow(TotpUnsupportedError);
	});

	test("rejects a secret too short to yield a byte", () => {
		expect(() => base32Decode("A")).toThrow(TotpUnsupportedError);
	});
});

describe("parseTotpSecret", () => {
	test("treats a bare secret as SHA1/6/30", () => {
		expect(parseTotpSecret("gezd gnbv-gy3t qojq")).toEqual({
			secret: "GEZDGNBVGY3TQOJQ",
			period: 30,
			digits: 6,
			algorithm: "SHA1",
		});
	});

	test("reads parameters out of an otpauth URI", () => {
		expect(
			parseTotpSecret(
				`otpauth://totp/Acme:me@acme.com?secret=${RFC_SHA1}&issuer=Acme&period=60&digits=8&algorithm=SHA256`,
			),
		).toEqual({
			secret: RFC_SHA1,
			period: 60,
			digits: 8,
			algorithm: "SHA256",
		});
	});

	test("defaults the parameters an otpauth URI leaves out", () => {
		const parsed = parseTotpSecret(`otpauth://totp/Acme?secret=${RFC_SHA1}`);
		expect(parsed).toMatchObject({ period: 30, digits: 6, algorithm: "SHA1" });
	});

	test("defers the shapes it cannot compute exactly to bw", () => {
		const unsupported = [
			"steam://ABCDEFGHIJKLMNOPQRSTUVWXYZ23",
			`otpauth://hotp/Acme?secret=${RFC_SHA1}`,
			"otpauth://totp/Acme?issuer=Acme",
			`otpauth://totp/Acme?secret=${RFC_SHA1}&algorithm=MD5`,
			`otpauth://totp/Acme?secret=${RFC_SHA1}&period=0`,
			"otpauth://totp/Acme?secret=not-base32!",
			"not base32 either!",
			"   ",
		];

		for (const raw of unsupported) {
			expect(() => parseTotpSecret(raw)).toThrow(TotpUnsupportedError);
		}
	});
});

describe("secondsRemaining", () => {
	test("counts down to the window boundary", () => {
		expect(secondsRemaining(30, 0)).toBe(30);
		expect(secondsRemaining(30, 1_000)).toBe(29);
		expect(secondsRemaining(30, 29_000)).toBe(1);
		expect(secondsRemaining(30, 30_000)).toBe(30);
	});

	test("follows a non-default period", () => {
		expect(secondsRemaining(60, 59_000)).toBe(1);
	});

	test("is reported alongside the code", () => {
		expect(generateTotp(config(), 29_000).secondsRemaining).toBe(1);
	});
});

describe("normalizeTotpInput", () => {
	test("strips the separators and padding authenticators display", () => {
		expect(normalizeTotpInput(" gezd gnbv-gy3t qojq== ")).toBe(
			"GEZDGNBVGY3TQOJQ",
		);
	});

	test("stores otpauth and steam secrets verbatim", () => {
		const uri = `otpauth://totp/Acme?secret=${RFC_SHA1}&period=60`;
		expect(normalizeTotpInput(uri)).toBe(uri);
		expect(normalizeTotpInput("steam://ABCDEFGHIJKLMNOPQRSTUVWXYZ23")).toBe(
			"steam://ABCDEFGHIJKLMNOPQRSTUVWXYZ23",
		);
	});

	test("rejects what would only fail at the login it breaks", () => {
		for (const raw of ["", "   ", "ABC189", "not base32!", "A"]) {
			expect(() => normalizeTotpInput(raw)).toThrow(CliError);
		}
	});

	test("rejects an otpauth URI that does not parse", () => {
		expect(() => normalizeTotpInput("otpauth://totp/Acme?issuer=Acme")).toThrow(
			CliError,
		);
	});

	test("keeps the rejected secret out of the error message", () => {
		try {
			normalizeTotpInput("SUPERSECRETVALUE!!");
			throw new Error("expected a rejection");
		} catch (err) {
			expect(err).toBeInstanceOf(CliError);
			expect((err as CliError).message).not.toContain("SUPERSECRETVALUE");
		}
	});
});

describe("normalizeBase32", () => {
	test("uppercases and drops separators without touching the payload", () => {
		expect(normalizeBase32("ge zd-gn bv==")).toBe("GEZDGNBV");
	});
});
