import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { CliError, ExitCode } from "../errors.ts";
import { filterItems, writeItems, type ItemListOptions } from "../items.ts";
import { runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";

export function registerSearch(program: Command): void {
	program
		.command("search").alias("find")
		.description("Search vault items")
		.argument("<query>", "Search query")
		.option("--type <type>", "Filter by type: login|note|card|identity")
		.option("--folder <id>", "Filter by folder ID")
		.option("--limit <n>", "Limit results", parseInt)
		.option("--full-items", "Emit complete item objects (includes secrets)")
		.action(async function (
			this: Command,
			query: string,
			localOpts: ItemListOptions & { folder?: string },
		) {
			const opts = getGlobalOpts(this);

			const args = ["list", "items", "--search", query];
			if (localOpts.folder) {
				args.push("--folderid", localOpts.folder);
			}

			const json = await withSession(opts, () => runBwOrThrow(args));
			const items = filterItems(JSON.parse(json), localOpts);

			if (items.length === 0) {
				throw new CliError(
					`No items matching "${query}"`,
					ExitCode.NotFound,
				);
			}

			writeItems(items, opts, localOpts);
		});
}
