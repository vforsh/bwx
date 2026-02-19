import { CliError, ExitCode } from "../cli/errors.ts";
import type { GlobalOptions } from "../cli/types.ts";
import { emitLog } from "../cli/io.ts";
import {
	runBw,
	runBwOrThrow,
	setSession,
	getSession,
	isAuthError,
	type BwResult,
} from "./runner.ts";
import { BwStatusSchema, type BwStatus } from "./types.ts";

const SESSION_PATH = `${process.env.HOME}/.config/bwx/session`;

async function loadCachedSession(): Promise<string | null> {
	try {
		const token = await Bun.file(SESSION_PATH).text();
		return token.trim() || null;
	} catch {
		return null;
	}
}

async function saveCachedSession(token: string): Promise<void> {
	const dir = SESSION_PATH.replace(/\/[^/]+$/, "");
	const { mkdirSync } = await import("node:fs");
	mkdirSync(dir, { recursive: true });
	await Bun.write(SESSION_PATH, token);
	const proc = Bun.spawn(["chmod", "600", SESSION_PATH]);
	await proc.exited;
}

async function clearCachedSession(): Promise<void> {
	try {
		const { unlinkSync } = await import("node:fs");
		unlinkSync(SESSION_PATH);
	} catch {
		// Already gone
	}
}

export async function getStatus(): Promise<BwStatus> {
	const result = await runBw(["status"], { session: null });
	try {
		return BwStatusSchema.parse(JSON.parse(result.stdout));
	} catch {
		throw new CliError(
			`Failed to parse bw status: ${result.stdout}`,
			ExitCode.BwError,
		);
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

export async function ensureUnlocked(
	opts: GlobalOptions,
): Promise<void> {
	// Try cached session first
	const cached = getSession() || (await loadCachedSession());
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
		emitLog("Logging in via API key...", opts);
		const loginResult = await runBw(["login", "--apikey", "--quiet"], {
			session: null,
		});
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
	await saveCachedSession(token);
}

export async function lockVault(): Promise<void> {
	await runBw(["lock"], { session: null });
	setSession(null);
	await clearCachedSession();
}

export async function withSession<T>(
	opts: GlobalOptions,
	fn: () => Promise<T>,
): Promise<T> {
	// Try with current/cached session
	const cached = getSession() || (await loadCachedSession());
	if (cached) {
		setSession(cached);
	}

	try {
		return await fn();
	} catch (err) {
		if (
			err instanceof CliError &&
			err.exitCode === ExitCode.AuthFailed
		) {
			// Clear stale session and re-auth
			setSession(null);
			await clearCachedSession();
			await ensureUnlocked(opts);
			return await fn();
		}
		throw err;
	}
}
