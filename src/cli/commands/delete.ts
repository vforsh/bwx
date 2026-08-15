import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData, emitSuccess } from "../io.ts";
import { CliError, ExitCode } from "../errors.ts";
import { runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";
import { readLine } from "../input.ts";
import type { GlobalOptions } from "../types.ts";
import pc from "picocolors";

export function registerDelete(program: Command): void {
	program
		.command("delete").alias("rm")
		.description("Delete a vault item")
		.argument("<item>", "Item name or ID")
		.option("--permanent", "Permanently delete (no trash)")
		.option("--force", "Skip confirmation prompt (required when not interactive)")
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

			await confirmDelete(itemName, itemId, localOpts, opts);

			const args = ["delete", "item", itemId];
			if (localOpts.permanent) args.push("--permanent");

			await withSession(opts, () => runBwOrThrow(args));

			if (opts.json) {
				emitData(
					{
						id: itemId,
						name: itemName,
						deleted: true,
						permanent: localOpts.permanent ?? false,
					},
					opts,
				);
			} else if (opts.plain) {
				emitData(itemId, opts);
			} else {
				const label = localOpts.permanent ? "Permanently deleted" : "Deleted";
				const undo = localOpts.permanent
					? ""
					: ` — undo with ${pc.dim(`bwx restore ${itemId}`)}`;
				emitSuccess(`${label} "${itemName}" (${itemId})${undo}`, opts);
			}
		});

}

/**
 * A prompt only guards a human at a terminal. The common caller here is a script
 * or an agent, where the prompt never renders — so anything non-interactive must
 * say `--force` out loud instead of being deleted on the strength of a flag that
 * silently did nothing.
 */
async function confirmDelete(
	itemName: string,
	itemId: string,
	localOpts: { permanent?: boolean; force?: boolean },
	opts: GlobalOptions,
): Promise<void> {
	if (localOpts.force) return;

	const interactive = process.stdin.isTTY && !opts.json && !opts.plain;
	const label = localOpts.permanent ? "permanently delete" : "delete";

	if (!interactive) {
		throw new CliError(
			`Refusing to ${label} "${itemName}" (${itemId}) without confirmation. Pass --force.`,
			ExitCode.BadArgs,
		);
	}

	process.stderr.write(
		`${pc.yellow("?")} ${label} "${itemName}" (${itemId})? [y/N] `,
	);
	const answer = await readLine();
	if (answer.toLowerCase() !== "y") {
		throw new CliError("Cancelled", ExitCode.UserCancelled);
	}
}
