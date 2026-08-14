import pc from "picocolors";
import { summarizeItem, type ItemSummary } from "../bw/items.ts";
import { BW_TYPE_FROM_NAME } from "../bw/types.ts";
import { CliError, ExitCode } from "./errors.ts";
import { emitData } from "./io.ts";
import type { GlobalOptions } from "./types.ts";

export interface ItemListOptions {
	type?: string;
	limit?: number;
	/** Opt in to raw bw items, which carry passwords, notes, and custom fields. */
	fullItems?: boolean;
}

export function filterItems(
	items: Array<Record<string, unknown>>,
	options: ItemListOptions,
): Array<Record<string, unknown>> {
	let result = items;

	if (options.type) {
		const typeVal = BW_TYPE_FROM_NAME[options.type];
		if (typeVal === undefined) {
			throw new CliError(
				`Invalid type "${options.type}". Valid: login, note, card, identity (plural forms accepted)`,
				ExitCode.BadArgs,
			);
		}
		result = result.filter((item) => item.type === typeVal);
	}

	if (options.limit && options.limit > 0) {
		result = result.slice(0, options.limit);
	}

	return result;
}

/**
 * Prints a set of vault items. Human, `--plain`, and `--json` output all carry
 * the same reduced projection, so asking for machine-readable output is a
 * serialization choice and never widens data access. `--full-items` is the
 * explicit opt-in for callers that genuinely need the complete objects.
 */
export function writeItems(
	items: Array<Record<string, unknown>>,
	opts: GlobalOptions,
	options: ItemListOptions = {},
): void {
	if (opts.json) {
		emitData(options.fullItems ? items : items.map(summarizeItem), opts);
		return;
	}

	if (options.fullItems) {
		// Plain output stays line-oriented: one compact item per line (NDJSON).
		if (opts.plain) writeLines(items, (item) => JSON.stringify(item));
		else emitData(items, opts);
		return;
	}

	writeLines(items.map(summarizeItem), opts.plain ? plainLine : humanLine);
}

function plainLine(summary: ItemSummary): string {
	return `${summary.id}\t${summary.type}\t${summary.name}\t${summary.username ?? "-"}`;
}

function humanLine(summary: ItemSummary): string {
	const userPart = summary.username ? pc.dim(` (${summary.username})`) : "";
	return `${pc.dim(summary.id)}  ${pc.cyan(summary.type)}  ${summary.name}${userPart}`;
}

function writeLines<T>(values: T[], format: (value: T) => string): void {
	for (const value of values) {
		process.stdout.write(format(value) + "\n");
	}
}
