import pc from "picocolors";
import { CliError, ExitCode } from "../cli/errors.ts";
import type { GlobalOptions } from "../cli/types.ts";
import { summarizeItem, type ItemSummary } from "./items.ts";
import { runBwOrThrow } from "./runner.ts";
import { withSession } from "./session.ts";
import { BwItemSchema, type BwItem } from "./types.ts";

/** Fields `bw get` resolves natively; anything else is a custom field name. */
const BUILTIN_FIELDS = [
	"password",
	"username",
	"totp",
	"notes",
	"uri",
	"item",
] as const;

/**
 * `totp` is a computed code, not stored data — only `bw get totp` can derive it,
 * so it is the one field that cannot be served from a fetched item.
 */
const DERIVED_FIELDS = new Set(["totp"]);

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
 * Raised when the item was found but the requested field was not. Distinct from
 * a missing *item* so the "did you mean this item?" suggestions below never fire
 * on an error that already names the fields that do exist.
 */
class FieldMissingError extends CliError {}

/** One `(field, item)` pair to resolve — see {@link readFields}. */
export interface FieldRequest {
	field: string;
	item: string;
	options?: ReadFieldOptions;
}

/**
 * Reads one field from a vault item and returns it verbatim (`item` yields the
 * item JSON), leaving the caller to decide whether the value is printed at all.
 */
export async function readItemField(
	field: string,
	item: string,
	opts: GlobalOptions,
	options?: ReadFieldOptions,
): Promise<string> {
	return withLookupHelp(item, opts, () =>
		isBuiltinField(field) && !options?.customOnly
			? readBuiltinField(field, item, opts)
			: readCustomField(field, item, opts),
	);
}

/**
 * Resolves many fields at once, paying a single `bw get item` per distinct item
 * rather than one `bw` spawn per field. Each spawn costs ~2.5s, so a caller
 * pulling a username and password from one item halves its own runtime.
 *
 * Returns values positionally aligned with `requests`.
 */
export async function readFields(
	requests: FieldRequest[],
	opts: GlobalOptions,
): Promise<string[]> {
	const values = new Array<string>(requests.length);
	const byItem = new Map<string, number[]>();

	for (const [index, request] of requests.entries()) {
		const bucket = byItem.get(request.item);
		if (bucket) bucket.push(index);
		else byItem.set(request.item, [index]);
	}

	for (const [item, indexes] of byItem) {
		// A single `bw` process at a time: each read may trigger an unlock, and
		// concurrent unlocks would race over the cached session.
		const derived = indexes.filter((i) => isDerived(requests[i]!));
		const stored = indexes.filter((i) => !isDerived(requests[i]!));

		if (stored.length > 0) {
			const fetched = await withLookupHelp(item, opts, () =>
				fetchItem(item, opts),
			);
			for (const index of stored) {
				const request = requests[index]!;
				values[index] = extractField(fetched, request.field, request.options);
			}
		}

		for (const index of derived) {
			const request = requests[index]!;
			values[index] = await withLookupHelp(item, opts, () =>
				readBuiltinField(request.field, item, opts),
			);
		}
	}

	return values;
}

function isDerived(request: FieldRequest): boolean {
	return !request.options?.customOnly && DERIVED_FIELDS.has(request.field);
}

/**
 * Turns bw's bare "Not found." and "More than one result" into errors that name
 * the candidates, so a caller can correct itself without a round of guessing.
 */
async function withLookupHelp<T>(
	item: string,
	opts: GlobalOptions,
	fn: () => Promise<T>,
): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof FieldMissingError) throw err;

		if (err instanceof CliError && /more than one result/i.test(err.message)) {
			throw new CliError(
				formatAmbiguous(item, await findMatches(item), opts),
				ExitCode.BadArgs,
			);
		}

		if (err instanceof CliError && err.exitCode === ExitCode.NotFound) {
			throw new CliError(
				formatNotFound(item, await findSimilar(item), opts),
				ExitCode.NotFound,
			);
		}

		throw err;
	}
}

async function fetchItem(item: string, opts: GlobalOptions): Promise<BwItem> {
	const json = await withSession(opts, () => runBwOrThrow(["get", "item", item]));
	return BwItemSchema.parse(JSON.parse(json));
}

/** Mirrors what `bw get <field>` would have returned for an already-fetched item. */
function extractField(
	item: BwItem,
	field: string,
	options?: ReadFieldOptions,
): string {
	if (!isBuiltinField(field) || options?.customOnly) {
		return pickCustomField(item, field);
	}

	if (field === "item") return JSON.stringify(item);

	const value =
		field === "notes"
			? item.notes
			: field === "uri"
				? (item.login?.uris?.[0]?.uri ?? null)
				: field === "username"
					? (item.login?.username ?? null)
					: (item.login?.password ?? null);

	if (!value) {
		throw new FieldMissingError(
			`No ${field} found for item: ${item.name}`,
			ExitCode.NotFound,
		);
	}

	return value;
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
		throw new FieldMissingError(
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
	return pickCustomField(await fetchItem(item, opts), fieldName);
}

function pickCustomField(item: BwItem, fieldName: string): string {
	const fields = item.fields ?? [];
	const match = fields.find((f) => f.name === fieldName);

	if (!match) {
		const available = fields.map((f) => f.name).join(", ");
		throw new FieldMissingError(
			available
				? `Field "${fieldName}" not found. Available: ${available}`
				: `Field "${fieldName}" not found (item has no custom fields)`,
			ExitCode.NotFound,
		);
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

/**
 * Looks for what the caller probably meant. bw's own search already came back
 * empty, so this pulls the item list once and scores it locally: one `bw` spawn
 * on the error path, and matching that survives typos and extra words the way
 * repeated `--search` calls do not.
 */
async function findSimilar(query: string): Promise<ItemSummary[]> {
	let summaries: ItemSummary[];
	try {
		const json = await runBwOrThrow(["list", "items"]);
		const items: Array<Record<string, unknown>> = JSON.parse(json);
		summaries = items.map(summarizeItem);
	} catch {
		return [];
	}

	return rankSimilar(query, summaries);
}

/** Pure so the suggestion quality is testable without a vault. */
export function rankSimilar(
	query: string,
	items: ItemSummary[],
	max = MAX_SUGGESTIONS,
): ItemSummary[] {
	const tokens = tokenize(query);
	if (tokens.length === 0) return [];

	const scored = items
		.map((item) => ({ item, score: scoreMatch(tokens, item) }))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));

	return scored.slice(0, max).map((entry) => entry.item);
}

/**
 * Length gates on the fuzzier rules keep short words from matching by accident —
 * without them "not" pulls in every item containing "evernote", and a suggestion
 * list full of noise is worse than none.
 */
function scoreMatch(tokens: string[], item: ItemSummary): number {
	const haystack = `${item.name} ${item.username ?? ""}`.toLowerCase();
	const itemTokens = tokenize(haystack);

	let score = 0;
	for (const token of tokens) {
		if (itemTokens.includes(token)) score += 3;
		else if (token.length >= 4 && haystack.includes(token)) score += 2;
		else if (
			token.length >= 3 &&
			itemTokens.some((other) => other.startsWith(token))
		) {
			score += 1;
		}
	}

	return score;
}

function tokenize(value: string): string[] {
	return value
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length >= 2);
}

const MAX_SUGGESTIONS = 5;

function formatNotFound(
	query: string,
	matches: ItemSummary[],
	opts: GlobalOptions,
): string {
	if (matches.length === 0) {
		return `No item matching "${query}". Run 'bwx search <query>' to find it.`;
	}

	if (opts.json) {
		return `No item matching "${query}". Did you mean: ${JSON.stringify(matches)}`;
	}

	return [
		`No item matching "${query}". Did you mean:\n`,
		...matches.map(formatCandidate),
	].join("\n");
}

function formatAmbiguous(
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

	return [
		`Multiple items match "${query}":\n`,
		...matches.map(formatCandidate),
		`\nUse a specific ID: ${pc.dim("bwx get <field> <id>")}`,
	].join("\n");
}

function formatCandidate(match: ItemSummary): string {
	const user = match.username ? ` (${match.username})` : "";
	return `  ${pc.dim(match.id)}  ${pc.cyan(match.type)}  ${match.name}${pc.dim(user)}`;
}
