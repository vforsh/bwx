import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitSuccess } from "../io.ts";
import { lockVault } from "../../bw/session.ts";

export function registerLock(program: Command): void {
	program
		.command("lock")
		.description("Lock vault and clear cached session")
		.action(async function (this: Command) {
			const opts = getGlobalOpts(this);
			await lockVault();
			emitSuccess("Vault locked", opts);
		});
}
