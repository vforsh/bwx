import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { CliError, ExitCode } from "../errors.ts";
import {
	filterItems,
	parseLimit,
	writeItems,
	type ItemListOptions,
} from "../items.ts";
import { runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";
import { resolveFolderFilter } from "../../bw/folders.ts";

export function registerSearch(program: Command): void {
	program
		.command("search")
		.alias("find")
		.description("Search vault items")
		.argument("<query>", "Search query")
		.option("--type <type>", "Filter by type: login|note|card|identity")
		.option("--folder <name|id>", "Filter by folder name or ID ('none' for unfiled)")
		.option("--limit <n>", "Limit results (0 for no limit)", parseLimit)
		.option("--full-items", "Emit complete item objects (includes secrets)")
		.action(async function (
			this: Command,
			query: string,
			localOpts: ItemListOptions & { folder?: string },
		) {
			const opts = getGlobalOpts(this);

			const args = ["list", "items", "--search", query];
			if (localOpts.folder) {
				args.push("--folderid", await resolveFolderFilter(localOpts.folder, opts));
			}

			const json = await withSession(opts, () => runBwOrThrow(args));
			const filtered = filterItems(JSON.parse(json), localOpts);

			if (filtered.total === 0) {
				throw new CliError(`No items matching "${query}"`, ExitCode.NotFound);
			}

			writeItems(filtered, opts, localOpts);
		});
}
