import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData } from "../io.ts";
import { recordStatus } from "../../bw/freshness.ts";
import { getStatus } from "../../bw/status.ts";
import { probeSessionState, type SessionState } from "../../bw/session.ts";
import pc from "picocolors";

const SESSION_HINTS: Record<SessionState, string> = {
	valid: "reads work without unlocking",
	stale: "cached session rejected — next read re-unlocks",
	none: "no cached session — next read unlocks",
};

export function registerStatus(program: Command): void {
	program
		.command("status")
		.description("Show vault status (no auto-unlock)")
		.action(async function (this: Command) {
			const opts = getGlobalOpts(this);
			const status = await getStatus();
			// Reads reuse this for their staleness check instead of paying for `bw status`.
			recordStatus(status);

			const session = await resolveSessionState(status.status, opts);
			const payload = { ...status, session };

			if (opts.json || opts.plain) {
				emitData(payload, opts);
				return;
			}

			const statusColor =
				status.status === "unlocked"
					? pc.green
					: status.status === "locked"
						? pc.yellow
						: pc.red;

			const sessionColor = session === "valid" ? pc.green : pc.yellow;

			const lines = [
				`${pc.dim("Status:")}   ${statusColor(status.status)}`,
				`${pc.dim("Session:")}  ${sessionColor(session)} ${pc.dim(`(${SESSION_HINTS[session]})`)}`,
				`${pc.dim("Email:")}    ${status.userEmail ?? "-"}`,
				`${pc.dim("Server:")}   ${status.serverUrl ?? "-"}`,
				`${pc.dim("Synced:")}   ${status.lastSync ?? "never"}`,
			];
			process.stdout.write(lines.join("\n") + "\n");
		});
}

/**
 * Only a locked vault leaves the question open — an unlocked one reads fine, and
 * an unauthenticated one has nothing a session could unlock. Skipping the probe
 * in those cases keeps `status` at a single `bw` call.
 */
async function resolveSessionState(
	vaultStatus: string,
	opts: ReturnType<typeof getGlobalOpts>,
): Promise<SessionState> {
	if (vaultStatus === "unlocked") return "valid";
	if (vaultStatus === "unauthenticated") return "none";
	return probeSessionState(opts);
}
