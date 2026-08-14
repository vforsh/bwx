import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitSuccess } from "../io.ts";
import { recordSyncNow } from "../../bw/freshness.ts";
import { runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";

export function registerSync(program: Command): void {
	program
		.command("sync")
		.description("Sync vault (auto-unlocks)")
		.action(async function (this: Command) {
			const opts = getGlobalOpts(this);
			// This *is* the freshness fix — checking freshness first would be circular.
			await withSession(opts, () => runBwOrThrow(["sync"]), {
				skipFreshnessCheck: true,
			});
			recordSyncNow();
			emitSuccess("Vault synced", opts);
		});
}
