import { CliError, ExitCode, classifyBwError } from "../cli/errors.ts";

export interface BwResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

let sessionToken: string | null = null;

export function setSession(token: string | null): void {
	sessionToken = token;
}

export function getSession(): string | null {
	return sessionToken;
}

export async function runBw(
	args: string[],
	options?: { session?: string | null; env?: Record<string, string> },
): Promise<BwResult> {
	const session = options?.session ?? sessionToken;
	const fullArgs = session ? [...args, "--session", session] : args;

	const proc = Bun.spawn(["bw", ...fullArgs], {
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
		env: options?.env ? { ...process.env, ...options.env } : undefined,
	});

	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);

	const exitCode = await proc.exited;

	return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

export async function runBwOrThrow(
	args: string[],
	options?: { session?: string | null; env?: Record<string, string> },
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

export function isAuthError(result: BwResult): boolean {
	return /not logged in|vault is locked|unauthenticated/i.test(result.stderr);
}
