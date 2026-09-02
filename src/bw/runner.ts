import { CliError, ExitCode, classifyBwError } from "../cli/errors.ts";
import { formatDuration } from "../cli/duration.ts";

export interface BwResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export interface RunBwOptions {
	/** Explicit session, or `null` to run without one (login/unlock/status). */
	session?: string | null;
	env?: Record<string, string>;
	/**
	 * Return stdout as `bw` wrote it, less the single newline `bw` adds to frame
	 * its own output. The default trim is right for values bwx parses or compares
	 * and wrong for a secret handed back byte-for-byte: whitespace around a
	 * password belongs to the password.
	 */
	verbatim?: boolean;
}

/** Deadline for a single `bw` call; overridable with `--timeout`. */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** Grace period between SIGTERM and SIGKILL for a `bw` process past its deadline. */
const KILL_GRACE_MS = 2_000;

let sessionToken: string | null = null;
let timeoutMs: number = DEFAULT_TIMEOUT_MS;

export function setSession(token: string | null): void {
	sessionToken = token;
}

export function getSession(): string | null {
	return sessionToken;
}

/** Applies the `--timeout` value for the rest of the process. */
export function setBwTimeout(ms: number): void {
	timeoutMs = ms;
}

export async function runBw(
	args: string[],
	options?: RunBwOptions,
): Promise<BwResult> {
	const session = options?.session ?? sessionToken;

	const proc = Bun.spawn(["bw", ...args], {
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
		// The session goes in the environment, never in argv: command lines are
		// readable by any same-user process. Nothing here is ever logged.
		env: buildEnv(session, options?.env),
	});

	const guard = timeoutMs > 0 ? armDeadline(proc, timeoutMs) : null;

	try {
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const exitCode = await proc.exited;

		if (guard?.expired) {
			throw new CliError(
				`bw ${args[0] ?? ""} timed out after ${formatDuration(timeoutMs)}`.trim(),
				ExitCode.Timeout,
			);
		}

		return {
			stdout: options?.verbatim ? unframe(stdout) : stdout.trim(),
			stderr: stderr.trim(),
			exitCode,
		};
	} finally {
		guard?.disarm();
	}
}

export async function runBwOrThrow(
	args: string[],
	options?: RunBwOptions,
): Promise<string> {
	const result = await runBw(args, options);
	if (result.exitCode !== 0) {
		const code = classifyBwError(result.stderr);
		throw new CliError(
			result.stderr || `bw ${args[0]} failed (exit ${result.exitCode})`,
			code,
		);
	}
	return result.stdout;
}

/** Drops the one newline `bw` prints after a value, and nothing the value owns. */
function unframe(stdout: string): string {
	return stdout.replace(/\r?\n$/, "");
}

/**
 * Child environment for `bw`. `BW_SESSION` is set from our session, or removed
 * outright so an ambient one from the caller's shell cannot silently substitute
 * for it (`status`, `login`, and `unlock` rely on seeing the real vault state).
 *
 * `BW_NOINTERACTION` is mandatory: bwx runs `bw` with stdin ignored, so a prompt
 * can only ever produce a hang or garbled output — a locked vault must fail
 * loudly instead, which is what lets callers auto-unlock and retry.
 */
function buildEnv(
	session: string | null,
	extra?: Record<string, string>,
): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = {
		...process.env,
		BW_NOINTERACTION: "true",
		...extra,
	};
	if (session) {
		env.BW_SESSION = session;
	} else {
		delete env.BW_SESSION;
	}
	return env;
}

interface Deadline {
	expired: boolean;
	disarm(): void;
}

/**
 * Kills `bw` once the deadline passes so a wedged vault operation (stuck Keychain
 * prompt, unreachable self-hosted server) cannot block the caller forever.
 */
function armDeadline(proc: Bun.Subprocess, ms: number): Deadline {
	const timers: ReturnType<typeof setTimeout>[] = [];
	const deadline: Deadline = {
		expired: false,
		disarm: () => timers.forEach(clearTimeout),
	};

	const arm = (delay: number, fn: () => void) => {
		const timer = setTimeout(fn, delay);
		timer.unref?.();
		timers.push(timer);
	};

	// A timer can still fire in the moment between exit and disarm, where the
	// signal has nowhere to go.
	const kill = (signal: NodeJS.Signals) => {
		try {
			proc.kill(signal);
		} catch {
			// Already gone.
		}
	};

	arm(ms, () => {
		deadline.expired = true;
		kill("SIGTERM");
		// Escalate if bw ignores SIGTERM.
		arm(KILL_GRACE_MS, () => kill("SIGKILL"));
	});

	return deadline;
}
