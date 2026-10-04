import pc from "picocolors";
import { summarizeItem, type ItemSummary } from "../bw/items.ts";
import { discoverItem, type ItemDiscovery } from "../bw/discovery.ts";
import { BW_TYPE_FROM_NAME } from "../bw/types.ts";
import { CliError, ExitCode } from "./errors.ts";
import { emitData, emitWarn } from "./io.ts";
import type { GlobalOptions } from "./types.ts";

/**
 * Listings are capped by default: an uncapped `bwx list` returns the whole vault,
 * which floods an agent's context and, with `--full-items`, dumps every secret in
 * one call. `--limit 0` is the explicit opt-out, and truncation is always
 * reported so a capped listing can never be mistaken for a complete one.
 */
export const DEFAULT_LIMIT = 50;

export interface ItemListOptions {
	type?: string;
	limit?: number;
	/** Opt in to raw bw items, which carry passwords, notes, and custom fields. */
	fullItems?: boolean;
	/** Metadata and consumable references only; never field values. */
	fields?: boolean;
}

export interface FilteredItems {
	items: Array<Record<string, unknown>>;
	/** Items matching the filters, before the limit was applied. */
	total: number;
}

/** Commander option parser: rejects garbage instead of silently ignoring it. */
export function parseLimit(raw: string): number {
	// `Number("")` and `Number(" ")` are 0, which would read as "no limit".
	const value = raw.trim() === "" ? Number.NaN : Number(raw);
	if (!Number.isInteger(value) || value < 0) {
		throw new CliError(
			`Invalid --limit "${raw}". Use a non-negative integer (0 for no limit).`,
			ExitCode.BadArgs,
		);
	}
	return value;
}

export function filterItems(
	items: Array<Record<string, unknown>>,
	options: ItemListOptions,
): FilteredItems {
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

	const total = result.length;
	const limit = options.limit ?? DEFAULT_LIMIT;

	return { items: limit > 0 ? result.slice(0, limit) : result, total };
}

/**
 * Prints a set of vault items. Human, `--plain`, and `--json` output all carry
 * the same reduced projection, so asking for machine-readable output is a
 * serialization choice and never widens data access. `--full-items` is the
 * explicit opt-in for callers that genuinely need the complete objects.
 * `--fields` uses a separate allowlist for capabilities and consumable refs.
 *
 * A truncated listing reports what it dropped through every channel — a stderr
 * warning that survives `--json`, plus `meta` in the JSON envelope — because a
 * silently capped list reads exactly like a complete one.
 */
export function writeItems(
	filtered: FilteredItems,
	opts: GlobalOptions,
	options: ItemListOptions = {},
): void {
	const { items, total } = filtered;
	const omitted = total - items.length;
	// Project the whole response before emitting anything, including warnings.
	const discovery = options.fields ? items.map(discoverItem) : undefined;

	if (omitted > 0) {
		emitWarn(
			`Showing ${items.length} of ${total} items — pass --limit 0 for all.`,
			opts,
		);
	}

	if (opts.json) {
		let data: unknown = items;
		if (discovery) data = discovery;
		else if (!options.fullItems) data = items.map(summarizeItem);
		emitData(
			data,
			opts,
			{ total, shown: items.length, truncated: omitted > 0 },
		);
		return;
	}
	if (discovery) {
		writeLines(discovery, opts.plain ? plainDiscovery : humanDiscovery);
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

function plainDiscovery(item: ItemDiscovery): string {
	return `${item.id}\t${item.type}\t${JSON.stringify(item.name)}\t${JSON.stringify(item.fields)}`;
}

function humanDiscovery(item: ItemDiscovery): string {
	const header = `${pc.dim(item.id)}  ${pc.cyan(item.type)}  ${JSON.stringify(item.name)}`;
	const fields = item.fields.map((field) =>
		`  ${field.kind} ${JSON.stringify(field.name)} [${field.type}]  ${field.ref}`,
	);
	return [header, ...fields].join("\n");
}

function plainLine(summary: ItemSummary): string {
	const totp = summary.hasTotp ? "totp" : "-";
	return `${summary.id}\t${summary.type}\t${summary.name}\t${summary.username ?? "-"}\t${totp}`;
}

function humanLine(summary: ItemSummary): string {
	const userPart = summary.username ? pc.dim(` (${summary.username})`) : "";
	const totpPart = summary.hasTotp ? " " + pc.yellow("2fa") : "";
	return `${pc.dim(summary.id)}  ${pc.cyan(summary.type)}  ${summary.name}${userPart}${totpPart}`;
}

function writeLines<T>(values: T[], format: (value: T) => string): void {
	for (const value of values) {
		process.stdout.write(format(value) + "\n");
	}
}
