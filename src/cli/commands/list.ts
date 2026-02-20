import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData } from "../io.ts";
import { CliError, ExitCode } from "../errors.ts";
import { runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";
import { BW_TYPE_LABELS, BW_TYPE_FROM_NAME } from "../../bw/types.ts";
import pc from "picocolors";

export function registerList(program: Command): void {
	program
		.command("list")
		.alias("ls")
		.description("List all vault items")
		.argument("[type]", "Filter by type: logins|notes|cards|identities")
		.option("--folder <id>", "Filter by folder ID")
		.option("--limit <n>", "Limit results", parseInt)
		.action(async function (
			this: Command,
			type: string | undefined,
			localOpts: { folder?: string; limit?: number },
		) {
			const opts = getGlobalOpts(this);

			const args = ["list", "items"];
			if (localOpts.folder) {
				args.push("--folderid", localOpts.folder);
			}

			const json = await withSession(opts, () => runBwOrThrow(args));
			let items: Array<Record<string, unknown>> = JSON.parse(json);

			if (type) {
				const typeVal = BW_TYPE_FROM_NAME[type];
				if (typeVal === undefined) {
					throw new CliError(
						`Invalid type "${type}". Valid: logins, notes, cards, identities`,
						ExitCode.BadArgs,
					);
				}
				items = items.filter((i) => i.type === typeVal);
			}

			if (localOpts.limit && localOpts.limit > 0) {
				items = items.slice(0, localOpts.limit);
			}

			if (items.length === 0) {
				throw new CliError("No items found", ExitCode.NotFound);
			}

			if (opts.json) {
				emitData(items, opts);
				return;
			}

			if (opts.plain) {
				for (const item of items) {
					const t =
						BW_TYPE_LABELS[item.type as number] ?? `type:${item.type}`;
					const login = item.login as Record<string, unknown> | null;
					const username = login?.username ?? "-";
					process.stdout.write(
						`${item.id}\t${t}\t${item.name}\t${username}\n`,
					);
				}
				return;
			}

			for (const item of items) {
				const t =
					BW_TYPE_LABELS[item.type as number] ?? `type:${item.type}`;
				const login = item.login as Record<string, unknown> | null;
				const username = login?.username ?? "";
				const userPart = username ? pc.dim(` (${username})`) : "";
				process.stdout.write(
					`${pc.dim(item.id as string)}  ${pc.cyan(t)}  ${item.name}${userPart}\n`,
				);
			}
		});
}
