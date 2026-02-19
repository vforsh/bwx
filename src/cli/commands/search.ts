import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData } from "../io.ts";
import { CliError, ExitCode } from "../errors.ts";
import { runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";
import { BW_TYPE_LABELS, BW_TYPE_FROM_NAME } from "../../bw/types.ts";
import pc from "picocolors";

export function registerSearch(program: Command): void {
	program
		.command("search")
		.description("Search vault items")
		.argument("<query>", "Search query")
		.option("--type <type>", "Filter by type: login|note|card|identity")
		.option("--folder <id>", "Filter by folder ID")
		.option("--limit <n>", "Limit results", parseInt)
		.action(async function (
			this: Command,
			query: string,
			localOpts: { type?: string; folder?: string; limit?: number },
		) {
			const opts = getGlobalOpts(this);

			const args = ["list", "items", "--search", query];
			if (localOpts.folder) {
				args.push("--folderid", localOpts.folder);
			}

			const json = await withSession(opts, () => runBwOrThrow(args));
			let items: Array<Record<string, unknown>> = JSON.parse(json);

			// Filter by type
			if (localOpts.type) {
				const typeVal = BW_TYPE_FROM_NAME[localOpts.type];
				if (typeVal === undefined) {
					throw new CliError(
						`Invalid type "${localOpts.type}". Valid: login, note, card, identity`,
						ExitCode.BadArgs,
					);
				}
				items = items.filter((i) => i.type === typeVal);
			}

			// Limit
			if (localOpts.limit && localOpts.limit > 0) {
				items = items.slice(0, localOpts.limit);
			}

			if (items.length === 0) {
				throw new CliError(
					`No items matching "${query}"`,
					ExitCode.NotFound,
				);
			}

			if (opts.json) {
				emitData(items, opts);
				return;
			}

			if (opts.plain) {
				for (const item of items) {
					const type = BW_TYPE_LABELS[item.type as number] ?? `type:${item.type}`;
					const login = item.login as Record<string, unknown> | null;
					const username = login?.username ?? "-";
					process.stdout.write(
						`${item.id}\t${type}\t${item.name}\t${username}\n`,
					);
				}
				return;
			}

			// Human-friendly table
			for (const item of items) {
				const type = BW_TYPE_LABELS[item.type as number] ?? `type:${item.type}`;
				const login = item.login as Record<string, unknown> | null;
				const username = login?.username ?? "";
				const userPart = username ? pc.dim(` (${username})`) : "";
				process.stdout.write(
					`${pc.dim(item.id as string)}  ${pc.cyan(type)}  ${item.name}${userPart}\n`,
				);
			}
		});
}
