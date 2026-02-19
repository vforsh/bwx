import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData } from "../io.ts";
import { getStatus } from "../../bw/session.ts";
import { BW_TYPE_LABELS } from "../../bw/types.ts";
import pc from "picocolors";

export function registerStatus(program: Command): void {
	program
		.command("status")
		.description("Show vault status (no auto-unlock)")
		.action(async function (this: Command) {
			const opts = getGlobalOpts(this);
			const status = await getStatus();

			if (opts.json || opts.plain) {
				emitData(status, opts);
				return;
			}

			const statusColor =
				status.status === "unlocked"
					? pc.green
					: status.status === "locked"
						? pc.yellow
						: pc.red;

			const lines = [
				`${pc.dim("Status:")}  ${statusColor(status.status)}`,
				`${pc.dim("Email:")}   ${status.userEmail ?? "-"}`,
				`${pc.dim("Server:")}  ${status.serverUrl ?? "-"}`,
				`${pc.dim("Synced:")}  ${status.lastSync ?? "never"}`,
			];
			process.stdout.write(lines.join("\n") + "\n");
		});
}
