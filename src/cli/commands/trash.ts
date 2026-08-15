import type { Command } from "commander";
import pc from "picocolors";
import { runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";
import { CliError, ExitCode } from "../errors.ts";
import { emitData, emitSuccess } from "../io.ts";
import { filterItems, parseLimit, writeItems, type ItemListOptions } from "../items.ts";
import { getGlobalOpts } from "../program.ts";
import type { GlobalOptions } from "../types.ts";

/**
 * `bwx delete` puts an item in the trash rather than destroying it, which is only
 * an undo if the trash can be read and reversed from here.
 */
export function registerTrash(program: Command): void {
	program
		.command("trash")
		.description("List items in the trash")
		.option("--limit <n>", "Limit results (0 for no limit)", parseLimit)
		.option("--full-items", "Emit complete item objects (includes secrets)")
		.action(async function (this: Command, localOpts: ItemListOptions) {
			const opts = getGlobalOpts(this);
			const filtered = filterItems(await listTrashed(opts), localOpts);

			if (filtered.total === 0) {
				throw new CliError("Trash is empty", ExitCode.NotFound);
			}

			writeItems(filtered, opts, localOpts);
		});

	program
		.command("restore")
		.description("Restore a deleted item from the trash")
		.argument("<item>", "Item name or ID, as shown by 'bwx trash'")
		.action(async function (this: Command, item: string) {
			const opts = getGlobalOpts(this);
			const trashed = await findTrashed(item, opts);
			const id = String(trashed.id);
			const name = String(trashed.name);

			await withSession(opts, () => runBwOrThrow(["restore", "item", id]));

			if (opts.json) {
				emitData({ id, name, restored: true }, opts);
			} else if (opts.plain) {
				emitData(id, opts);
			} else {
				emitSuccess(`Restored "${name}" (${id})`, opts);
			}
		});
}

async function listTrashed(
	opts: GlobalOptions,
): Promise<Array<Record<string, unknown>>> {
	const json = await withSession(opts, () =>
		runBwOrThrow(["list", "items", "--trash"]),
	);
	return JSON.parse(json) as Array<Record<string, unknown>>;
}

async function findTrashed(
	item: string,
	opts: GlobalOptions,
): Promise<Record<string, unknown>> {
	const trashed = await listTrashed(opts);

	const matches = trashed.filter(
		(entry) =>
			entry.id === item ||
			String(entry.name ?? "").toLowerCase() === item.toLowerCase(),
	);

	if (matches.length === 0) {
		throw new CliError(
			`No trashed item matching "${item}". Run 'bwx trash' to list them.`,
			ExitCode.NotFound,
		);
	}

	if (matches.length > 1) {
		const lines = [`Multiple trashed items match "${item}":\n`];
		for (const match of matches) {
			lines.push(`  ${pc.dim(String(match.id))}  ${String(match.name)}`);
		}
		lines.push("\nUse a specific ID.");
		throw new CliError(lines.join("\n"), ExitCode.BadArgs);
	}

	return matches[0]!;
}
