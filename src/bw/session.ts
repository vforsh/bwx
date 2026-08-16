import { unlinkSync } from "node:fs";
import { CliError, ExitCode } from "../cli/errors.ts";
import type { GlobalOptions } from "../cli/types.ts";
import { emitLog, emitWarn } from "../cli/io.ts";
import { SESSION_FILE, SESSION_LOCK_DIR } from "../config/paths.ts";
import { withProcessLock } from "../config/process-lock.ts";
import { readPrivateFile, writePrivateFile } from "../config/secure-file.ts";
import {
	DEFAULT_TIMEOUT_MS,
	runBw,
	runBwOrThrow,
	setSession,
	getSession,
} from "./runner.ts";
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

/**
 * Whether reads will work right now without an unlock. `bw status` answers for
 * the vault, not for us: it reports "locked" whenever the vault has no session
 * of its own, even when bwx holds a cached one that works perfectly. Reporting
 * that raw answer sends callers off to unlock a vault they can already read.
 */
export type SessionState =
	/** Cached session works — reads succeed with no unlock. */
	| "valid"
	/** A session was cached but the vault no longer accepts it. */
	| "stale"
	/** Nothing cached; the next read unlocks. */
	| "none";

/** Confirms a token by asking the vault, which is the only authority on it. */
async function sessionWorks(token: string): Promise<boolean> {
	const check = await runBw(["status"], { session: token });
	if (check.exitCode !== 0) return false;
	try {
		return (
			BwStatusSchema.parse(JSON.parse(check.stdout)).status === "unlocked"
		);
	} catch {
		return false;
	}
}

export async function probeSessionState(
	opts: GlobalOptions,
): Promise<SessionState> {
	const cached = getSession() || loadCachedSession(opts);
	if (!cached) return "none";
	return (await sessionWorks(cached)) ? "valid" : "stale";
}

export async function ensureUnlocked(opts: GlobalOptions): Promise<void> {
	// Keep the ordinary valid-session path entirely outside the process lock.
	const cached = getSession() || loadCachedSession(opts);
	if (cached) {
		setSession(cached);
		if (await sessionWorks(cached)) return;
		setSession(null);
	}

	await withProcessLock(
		{
			path: SESSION_LOCK_DIR,
			label: "Bitwarden session establishment",
			waitMs: sessionLockWaitMs(opts),
		},
		async () => {
			// A process that waited must use the winner's disk cache, not the stale
			// token it may still have held in memory before entering the lock.
			const winner = loadCachedSession(opts);
			if (winner) {
				setSession(winner);
				if (await sessionWorks(winner)) return;
				setSession(null);
			}

			await establishSession(opts);
		},
	);
}

async function establishSession(opts: GlobalOptions): Promise<void> {
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

/** Four sequential `bw` calls cover stale validation plus status/login/unlock. */
function sessionLockWaitMs(opts: GlobalOptions): number {
	const perCall =
		opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
	return Math.min(Math.max(perCall * 4 + 10_000, 10_000), 5 * 60_000);
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
			// Do not unlink the shared cache here: another process may already have
			// atomically replaced our stale token with a freshly unlocked session.
			setSession(null);
			await ensureUnlocked(opts);
			return await fn();
		}
		throw err;
	}
}
