import { CliError, ExitCode } from "../cli/errors.ts";
import { runBw } from "./runner.ts";
import { BwStatusSchema, type BwStatus } from "./types.ts";

/**
 * Reads the vault state. Deliberately runs without a session so the result
 * reflects the vault itself rather than our cached unlock.
 */
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
