import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitSuccess } from "../io.ts";
import { runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";

export function registerSync(program: Command): void {
	program
		.command("sync")
		.description("Sync vault (auto-unlocks)")
		.action(async function (this: Command) {
			const opts = getGlobalOpts(this);
			await withSession(opts, () => runBwOrThrow(["sync"]));
			emitSuccess("Vault synced", opts);
		});
}
