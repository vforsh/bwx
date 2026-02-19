import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitSuccess } from "../io.ts";
import { ensureUnlocked } from "../../bw/session.ts";

export function registerUnlock(program: Command): void {
	program
		.command("unlock")
		.description("Unlock vault (caches session)")
		.action(async function (this: Command) {
			const opts = getGlobalOpts(this);
			await ensureUnlocked(opts);
			emitSuccess("Vault unlocked", opts);
		});
}
