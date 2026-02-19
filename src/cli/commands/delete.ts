import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData, emitSuccess } from "../io.ts";
import { CliError, ExitCode } from "../errors.ts";
import { runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";
import pc from "picocolors";

export function registerDelete(program: Command): void {
	program
		.command("delete")
		.description("Delete a vault item")
		.argument("<item>", "Item name or ID")
		.option("--permanent", "Permanently delete (no trash)")
		.option("--force", "Skip confirmation prompt")
		.action(async function (
			this: Command,
			item: string,
			localOpts: { permanent?: boolean; force?: boolean },
		) {
			const opts = getGlobalOpts(this);

			// Resolve item to get ID and name
			const json = await withSession(opts, () =>
				runBwOrThrow(["get", "item", item]),
			);
			const current = JSON.parse(json);
			const itemId: string = current.id;
			const itemName: string = current.name;

			// Confirm unless --force, --json, or --plain
			if (!localOpts.force && !opts.json && !opts.plain && process.stdin.isTTY) {
				const label = localOpts.permanent ? "permanently delete" : "delete";
				process.stderr.write(
					`${pc.yellow("?")} ${label} "${itemName}" (${itemId})? [y/N] `,
				);
				const answer = await readLine();
				if (answer.toLowerCase() !== "y") {
					throw new CliError("Cancelled", ExitCode.UserCancelled);
				}
			}

			const args = ["delete", "item", itemId];
			if (localOpts.permanent) args.push("--permanent");

			await withSession(opts, () => runBwOrThrow(args));

			if (opts.json) {
				emitData({ id: itemId, name: itemName, deleted: true }, opts);
			} else if (opts.plain) {
				emitData(itemId, opts);
			} else {
				const label = localOpts.permanent ? "Permanently deleted" : "Deleted";
				emitSuccess(`${label} "${itemName}" (${itemId})`, opts);
			}
		});
}

async function readLine(): Promise<string> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of Bun.stdin.stream()) {
		chunks.push(chunk);
		const text = Buffer.concat(chunks).toString();
		if (text.includes("\n")) return text.split("\n")[0]!.trim();
	}
	return Buffer.concat(chunks).toString().trim();
}
