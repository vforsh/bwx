import { unlinkSync } from "node:fs";
import { CliError, ExitCode } from "../cli/errors.ts";
import type { GlobalOptions } from "../cli/types.ts";
import { emitLog, emitWarn } from "../cli/io.ts";
import { SESSION_FILE } from "../config/paths.ts";
import { readPrivateFile, writePrivateFile } from "../config/secure-file.ts";
import { runBw, runBwOrThrow, setSession, getSession } from "./runner.ts";
import { checkVaultFreshness } from "./freshness.ts";
import { getStatus } from "./status.ts";
import { BwStatusSchema } from "./types.ts";
import { loadConfig } from "../config/store.ts";

/**
 * Loads the cached session, ignoring a cache file that another user could have
 * planted or read. Rejection is not fatal: the caller just unlocks again.
 */
function loadCachedSession(opts: GlobalOptions): string | null {
	const read = readPrivateFile(SESSION_FILE);
	if (read.kind === "rejected") {
		emitWarn(`Ignoring cached session: ${read.reason}`, opts);
		return null;
	}
	if (read.kind === "missing") return null;
	return read.text.trim() || null;
}

function saveCachedSession(token: string): void {
	writePrivateFile(SESSION_FILE, token);
}

function clearCachedSession(): void {
	try {
		unlinkSync(SESSION_FILE);
	} catch {
		// Already gone
	}
}

async function getMasterPassword(): Promise<string> {
	const proc = Bun.spawn(
		[
			"security",
			"find-generic-password",
			"-a",
			"bitwarden",
			"-s",
			"bitwarden-master",
			"-w",
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const pw = (await new Response(proc.stdout).text()).trim();
	const exitCode = await proc.exited;
	if (exitCode !== 0 || !pw) {
		throw new CliError(
			"Master password not found in Keychain",
			ExitCode.AuthFailed,
		);
	}
	return pw;
}

export async function ensureUnlocked(opts: GlobalOptions): Promise<void> {
	// Try cached session first
	const cached = getSession() || loadCachedSession(opts);
	if (cached) {
		setSession(cached);
		// Quick check — try a lightweight command
		const check = await runBw(["status"]);
		if (check.exitCode === 0) {
			try {
				const status = BwStatusSchema.parse(JSON.parse(check.stdout));
				if (status.status === "unlocked") return;
			} catch {
				// Fall through
			}
		}
	}

	const status = await getStatus();

	if (status.status === "unlocked") {
		return;
	}

	if (status.status === "unauthenticated") {
		const config = await loadConfig();
		if (!config.email) {
			throw new CliError(
				"Email not configured. Run: bwx config email",
				ExitCode.AuthFailed,
			);
		}

		const pw = await getMasterPassword();
		emitLog("Logging in...", opts);
		const loginResult = await runBw(
			["login", config.email, "--passwordenv", "BW_MASTER_PW", "--quiet"],
			// BW_NOINTERACTION is set for every bw call by the runner.
			{ session: null, env: { BW_MASTER_PW: pw } },
		);
		if (loginResult.exitCode !== 0) {
			throw new CliError(
				`Login failed: ${loginResult.stderr}`,
				ExitCode.AuthFailed,
			);
		}
	}

	// Unlock
	const pw = await getMasterPassword();
	emitLog("Unlocking vault...", opts);
	const unlockResult = await runBw(
		["unlock", "--passwordenv", "BW_MASTER_PW", "--raw"],
		{ session: null, env: { BW_MASTER_PW: pw } },
	);
	if (unlockResult.exitCode !== 0 || !unlockResult.stdout) {
		throw new CliError(
			`Unlock failed: ${unlockResult.stderr}`,
			ExitCode.AuthFailed,
		);
	}

	const token = unlockResult.stdout;
	setSession(token);
	saveCachedSession(token);
}

export async function lockVault(): Promise<void> {
	await runBw(["lock"], { session: null });
	setSession(null);
	clearCachedSession();
}

interface SessionOptions {
	/**
	 * Skips the stale-vault check. Set by operations that own vault freshness
	 * themselves (`sync`) to avoid recursion.
	 */
	skipFreshnessCheck?: boolean;
}

export async function withSession<T>(
	opts: GlobalOptions,
	fn: () => Promise<T>,
	options?: SessionOptions,
): Promise<T> {
	// Try with current/cached session
	const cached = getSession() || loadCachedSession(opts);
	if (cached) {
		setSession(cached);
	}

	if (!options?.skipFreshnessCheck) {
		await checkVaultFreshness(opts, () => syncVault(opts));
	}

	return withAuthRetry(opts, fn);
}

async function syncVault(opts: GlobalOptions): Promise<void> {
	await withAuthRetry(opts, () => runBwOrThrow(["sync"]));
}

/** Runs `fn`, re-authenticating once if the cached session turned out to be stale. */
async function withAuthRetry<T>(
	opts: GlobalOptions,
	fn: () => Promise<T>,
): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof CliError && err.exitCode === ExitCode.AuthFailed) {
			// Clear stale session and re-auth
			setSession(null);
			clearCachedSession();
			await ensureUnlocked(opts);
			return await fn();
		}
		throw err;
	}
}
