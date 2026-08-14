import pc from "picocolors";
import { CliError, ExitCode } from "../cli/errors.ts";
import type { GlobalOptions } from "../cli/types.ts";
import { summarizeItem, type ItemSummary } from "./items.ts";
import { runBwOrThrow } from "./runner.ts";
import { withSession } from "./session.ts";
import { BwItemSchema } from "./types.ts";

/** Fields `bw get` resolves natively; anything else is a custom field name. */
const BUILTIN_FIELDS = [
	"password",
	"username",
	"totp",
	"notes",
	"uri",
	"item",
] as const;

function isBuiltinField(field: string): boolean {
	return (BUILTIN_FIELDS as readonly string[]).includes(field);
}

export interface ReadFieldOptions {
	/**
	 * Always resolve `field` as a custom field name, so an item whose custom
	 * field is called e.g. `password` is still reachable.
	 */
	customOnly?: boolean;
}

/**
 * Reads one field from a vault item and returns it verbatim (`item` yields the
 * item JSON), leaving the caller to decide whether the value is printed at all.
 * Ambiguous item lookups fail with the candidate list instead of a raw bw error.
 */
export async function readItemField(
	field: string,
	item: string,
	opts: GlobalOptions,
	options?: ReadFieldOptions,
): Promise<string> {
	try {
		return isBuiltinField(field) && !options?.customOnly
			? await readBuiltinField(field, item, opts)
			: await readCustomField(field, item, opts);
	} catch (err) {
		if (err instanceof CliError && /more than one result/i.test(err.message)) {
			const matches = await findMatches(item);
			throw new CliError(
				formatAmbiguousError(item, matches, opts),
				ExitCode.BadArgs,
			);
		}
		throw err;
	}
}

async function readBuiltinField(
	field: string,
	item: string,
	opts: GlobalOptions,
): Promise<string> {
	const result = await withSession(opts, () =>
		runBwOrThrow(["get", field, item]),
	);

	if (!result) {
		throw new CliError(
			`No ${field} found for item: ${item}`,
			ExitCode.NotFound,
		);
	}

	return result;
}

async function readCustomField(
	fieldName: string,
	item: string,
	opts: GlobalOptions,
): Promise<string> {
	const json = await withSession(opts, () =>
		runBwOrThrow(["get", "item", item]),
	);

	const parsed = BwItemSchema.parse(JSON.parse(json));
	const fields = parsed.fields ?? [];
	const match = fields.find((f) => f.name === fieldName);

	if (!match) {
		const available = fields.map((f) => f.name).join(", ");
		const msg = available
			? `Field "${fieldName}" not found. Available: ${available}`
			: `Field "${fieldName}" not found (item has no custom fields)`;
		throw new CliError(msg, ExitCode.NotFound);
	}

	return match.value ?? "";
}

async function findMatches(query: string): Promise<ItemSummary[]> {
	try {
		const json = await runBwOrThrow(["list", "items", "--search", query]);
		const items: Array<Record<string, unknown>> = JSON.parse(json);
		return items.map(summarizeItem);
	} catch {
		return [];
	}
}

function formatAmbiguousError(
	query: string,
	matches: ItemSummary[],
	opts: GlobalOptions,
): string {
	if (matches.length === 0) {
		return `Multiple items match "${query}". Use a specific ID instead.`;
	}

	if (opts.json) {
		return `Multiple items match "${query}": ${JSON.stringify(matches)}`;
	}

	const lines = [`Multiple items match "${query}":\n`];
	for (const m of matches) {
		const user = m.username ? ` (${m.username})` : "";
		lines.push(
			`  ${pc.dim(m.id)}  ${pc.cyan(m.type)}  ${m.name}${pc.dim(user)}`,
		);
	}
	lines.push(`\nUse a specific ID: ${pc.dim("bwx get <field> <id>")}`);
	return lines.join("\n");
}
