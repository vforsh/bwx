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

export function registerList(program: Command): void {
	program
		.command("list")
		.alias("ls")
		.description("List all vault items")
		.argument("[type]", "Filter by type: logins|notes|cards|identities")
		.option("--type <type>", "Filter by type (same as the positional form)")
		.option("--folder <name|id>", "Filter by folder name or ID ('none' for unfiled)")
		.option("--limit <n>", "Limit results (0 for no limit)", parseLimit)
		.option("--full-items", "Emit complete item objects (includes secrets)")
		.action(async function (
			this: Command,
			positionalType: string | undefined,
			localOpts: ItemListOptions & { folder?: string },
		) {
			const opts = getGlobalOpts(this);

			if (positionalType && localOpts.type && positionalType !== localOpts.type) {
				throw new CliError(
					`Conflicting types: "${positionalType}" and --type ${localOpts.type}`,
					ExitCode.BadArgs,
				);
			}

			const args = ["list", "items"];
			if (localOpts.folder) {
				args.push("--folderid", await resolveFolderFilter(localOpts.folder, opts));
			}

			const json = await withSession(opts, () => runBwOrThrow(args));
			const filtered = filterItems(JSON.parse(json), {
				...localOpts,
				type: positionalType ?? localOpts.type,
			});

			if (filtered.total === 0) {
				throw new CliError("No items found", ExitCode.NotFound);
			}

			writeItems(filtered, opts, localOpts);
		});
}
