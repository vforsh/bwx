import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { CliError, ExitCode } from "../errors.ts";
import { filterItems, writeItems, type ItemListOptions } from "../items.ts";
import { runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";

export function registerList(program: Command): void {
	program
		.command("list")
		.alias("ls")
		.description("List all vault items")
		.argument("[type]", "Filter by type: logins|notes|cards|identities")
		.option("--folder <id>", "Filter by folder ID")
		.option("--limit <n>", "Limit results", parseInt)
		.option("--full-items", "Emit complete item objects (includes secrets)")
		.action(async function (
			this: Command,
			type: string | undefined,
			localOpts: ItemListOptions & { folder?: string },
		) {
			const opts = getGlobalOpts(this);

			const args = ["list", "items"];
			if (localOpts.folder) {
				args.push("--folderid", localOpts.folder);
			}

			const json = await withSession(opts, () => runBwOrThrow(args));
			const items = filterItems(JSON.parse(json), { ...localOpts, type });

			if (items.length === 0) {
				throw new CliError("No items found", ExitCode.NotFound);
			}

			writeItems(items, opts, localOpts);
		});
}
