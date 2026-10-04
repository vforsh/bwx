import { CliError, ExitCode } from "../cli/errors.ts";

const REASONS: Partial<Record<ExitCode, string>> = {
	[ExitCode.AuthFailed]: "authentication failed",
	[ExitCode.NotFound]: "item or field not found",
	[ExitCode.BadArgs]: "invalid arguments or stale reference",
	[ExitCode.Network]: "network error",
	[ExitCode.Timeout]: "timeout",
	[ExitCode.Config]: "configuration error",
};

/** Vault diagnostics and parse errors can contain values. Never forward them. */
export async function withSafeVaultErrors<T>(
	context: string,
	fn: () => Promise<T>,
): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		const code = err instanceof CliError ? err.exitCode : ExitCode.BwError;
		const reason = REASONS[code] ?? "vault command or response failed";
		throw new CliError(`${context}: ${reason}.`, code);
	}
}
