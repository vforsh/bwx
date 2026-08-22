import pc from "picocolors";
import { CliError, ExitCode } from "../cli/errors.ts";
import type { GlobalOptions } from "../cli/types.ts";
import { summarizeItem, type ItemSummary } from "./items.ts";
import { runBwOrThrow } from "./runner.ts";
import { withSession } from "./session.ts";
import {
	DEFAULT_PERIOD,
	generateTotp,
	parseTotpSecret,
	secondsRemaining,
	TotpUnsupportedError,
	type TotpCode,
} from "./totp.ts";
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

function isBuiltinField(field: string): boolean {
	return (BUILTIN_FIELDS as readonly string[]).includes(field);
}

/** True when `field` should be read as the item's TOTP rather than a custom field. */
function isTotpField(field: string, options?: ReadFieldOptions): boolean {
	return field === "totp" && !options?.customOnly;
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
	return withLookupHelp(item, opts, async () => {
		if (isTotpField(field, options)) {
			const nextCode = resolveTotpSource(await fetchItem(item, opts), item, opts);
			return (await nextCode()).code;
		}

		return isBuiltinField(field) && !options?.customOnly
			? readBuiltinField(field, item, opts)
			: readCustomField(field, item, opts);
	});
}

export interface ReadTotpOptions {
	/**
	 * Wait for the next window when the code has fewer than this many seconds
	 * left, rather than handing back one that expires on the way to the prompt.
	 */
	minSecondsRemaining?: number;
	/** Notified with the seconds about to be spent waiting, for progress output. */
	onWait?: (seconds: number) => void;
}

/**
 * Reads a TOTP with the time it has left. A code handed over with three seconds
 * on it is usually dead before it is pasted, so callers get the remainder to
 * decide for themselves — or set `minSecondsRemaining` and have the wait handled
 * here, where the secret is still in hand and a fresh code is free.
 */
export async function readTotp(
	item: string,
	opts: GlobalOptions,
	options?: ReadTotpOptions,
): Promise<TotpCode> {
	return withLookupHelp(item, opts, async () => {
		const nextCode = resolveTotpSource(await fetchItem(item, opts), item, opts);
		return awaitUsableWindow(nextCode, options);
	});
}

/** The stored secret itself, for moving a seed back out to another authenticator. */
export async function readTotpSecret(
	item: string,
	opts: GlobalOptions,
): Promise<string> {
	return withLookupHelp(item, opts, async () => {
		const fetched = await fetchItem(item, opts);
		return requireStoredTotp(fetched);
	});
}

function requireStoredTotp(item: BwItem): string {
	const stored = item.login?.totp;
	if (!stored) {
		throw new FieldMissingError(
			`No totp found for item: ${item.name}`,
			ExitCode.NotFound,
		);
	}
	return stored;
}

/**
 * Produces a code for the current window. Callable rather than a single resolved
 * value so waiting out a nearly-dead window is cheap: the local path just runs
 * the HMAC again over the secret it captured.
 */
type TotpSource = () => Promise<TotpCode>;

/**
 * Decides how this item's codes are computed: locally from the secret already in
 * hand, or by `bw get totp` for the shapes this codebase will not compute itself
 * (see `totp.ts`). The fallback costs a spawn per code, which is the correct
 * trade against emitting a confidently wrong six digits.
 */
function resolveTotpSource(
	fetched: BwItem,
	item: string,
	opts: GlobalOptions,
): TotpSource {
	const stored = requireStoredTotp(fetched);

	try {
		const config = parseTotpSecret(stored);
		return async () => generateTotp(config);
	} catch (err) {
		if (!(err instanceof TotpUnsupportedError)) throw err;
	}

	return async () => ({
		code: await readBuiltinField("totp", item, opts),
		period: DEFAULT_PERIOD,
		secondsRemaining: secondsRemaining(DEFAULT_PERIOD),
	});
}

/**
 * Sleeps out a window with too little left, then asks the source for the next
 * code. Only the `bw` fallback pays a second spawn for that; the local path
 * recomputes from the secret it holds, so the returned code has a full window
 * rather than one already spent on a second vault round-trip.
 */
async function awaitUsableWindow(
	nextCode: TotpSource,
	options?: ReadTotpOptions,
): Promise<TotpCode> {
	const code = await nextCode();

	const minimum = options?.minSecondsRemaining;
	if (minimum === undefined || code.secondsRemaining >= minimum) return code;

	options?.onWait?.(code.secondsRemaining);
	// The extra beat lands just past the boundary rather than exactly on it.
	await Bun.sleep(code.secondsRemaining * 1000 + 250);
	return nextCode();
}

/**
 * Resolves many fields at once, paying a single `bw get item` per distinct item
 * rather than one `bw` spawn per field. Each spawn costs ~2.5s, so a caller
 * pulling a username and password from one item halves its own runtime. `totp`
 * joins that batch too, since the code is computed from the secret the fetch
 * already returned.
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
		const fetched = await withLookupHelp(item, opts, () => fetchItem(item, opts));

		for (const index of indexes) {
			const request = requests[index]!;

			if (isTotpField(request.field, request.options)) {
				const nextCode = resolveTotpSource(fetched, item, opts);
				values[index] = (await withLookupHelp(item, opts, nextCode)).code;
			} else {
				values[index] = extractField(fetched, request.field, request.options);
			}
		}
	}

	return values;
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

	// Named exhaustively rather than defaulted: a chain ending in `password`
	// would hand back the password for any field it failed to recognize.
	let value: string | null;
	switch (field) {
		case "notes":
			value = item.notes;
			break;
		case "uri":
			value = item.login?.uris?.[0]?.uri ?? null;
			break;
		case "username":
			value = item.login?.username ?? null;
			break;
		case "password":
			value = item.login?.password ?? null;
			break;
		default:
			throw new FieldMissingError(
				`Field "${field}" cannot be read from a fetched item`,
				ExitCode.NotFound,
			);
	}

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
