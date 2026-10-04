import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData, emitLog, emitRaw } from "../io.ts";
import {
	BUILTIN_FIELDS, readItemField, readTotp, readTotpSecret, type FieldRequest,
} from "../../bw/fields.ts";
import { CARD_FIELDS } from "../../bw/cards.ts";
import { CliError, ExitCode } from "../errors.ts";
import { parseFieldReference, REFERENCE_PREFIX } from "../../bw/references.ts";
import type { GlobalOptions } from "../types.ts";

/** Seconds left below which `--fresh` waits, when the flag is given bare. */
const DEFAULT_FRESH_SECONDS = 5;

/** Written once so `get` and `field` describe `--raw` in the same words. */
const RAW_DESCRIPTION =
	"Suppress only the trailing newline bwx adds; newlines stored in the value are kept";

interface GetOptions {
	fresh?: string | boolean;
	seed?: boolean;
	raw?: boolean;
}

export function registerGet(program: Command): void {
	program
		.command("get")
		.description("Get a field from a vault item or a discovered bwx:// reference")
		.argument(
			"<field>",
			`Field or bwx:// ref: ${BUILTIN_FIELDS.join(" | ")} | <custom>. Card items also take: ${CARD_FIELDS.join(" | ")}`,
		)
		.argument("[item]", "Item name or ID (omit when the field is a bwx:// reference)")
		.option(
			"--fresh [seconds]",
			`Wait for the next TOTP window if fewer than N seconds remain (default ${DEFAULT_FRESH_SECONDS})`,
		)
		.option("--seed", "Emit the stored TOTP secret instead of a code")
		.option("--raw", RAW_DESCRIPTION)
		.action(async function (
			this: Command,
			field: string,
			item: string | undefined,
			localOpts: GetOptions,
		) {
			const opts = getGlobalOpts(this);
			assertRawUsable(localOpts, opts);
			const request = parseGetRequest(field, item);

			if (request.field === "totp" && !request.options?.customOnly) {
				await emitTotp(request.item, localOpts, opts, request.options?.exactItemId);
				return;
			}

			assertTotpOnlyFlags(request.field, localOpts);

			const value = await readItemField(request.field, request.item, opts, {
				...request.options,
				verbatim: localOpts.raw,
			});

			// `item` is the one field that is itself JSON, so it is emitted as
			// structure — except under `--raw`, which promised the bytes `bw` gave us.
			if (request.field === "item" && !request.options?.customOnly && !localOpts.raw) {
				emitData(JSON.parse(value), opts);
				return;
			}

			emitValue(value, localOpts, opts);
		});

	program
		.command("field")
		.description("Get a custom field from a vault item (never a built-in)")
		// Same order as `get`, which is the whole point of this command existing
		// alongside it — the two used to take their arguments back to front.
		.argument("<name>", "Custom field name")
		.argument("<item>", "Item name or ID")
		.option("--raw", RAW_DESCRIPTION)
		.action(async function (
			this: Command,
			name: string,
			item: string,
			localOpts: { raw?: boolean },
		) {
			const opts = getGlobalOpts(this);
			assertRawUsable(localOpts, opts);

			try {
				const value = await readItemField(name, item, opts, { customOnly: true });
				emitValue(value, localOpts, opts);
			} catch (err) {
				throw withOrderHint(err);
			}
		});
}

function parseGetRequest(field: string, item: string | undefined): FieldRequest {
	if (field.startsWith(REFERENCE_PREFIX)) {
		const reference = parseFieldReference(field);
		if (item !== undefined) {
			throw new CliError("A field reference already contains the item ID; omit <item>.", ExitCode.BadArgs);
		}
		return reference;
	}
	if (item === undefined) {
		throw new CliError("Expected get <field> <item> or get <ref>.", ExitCode.BadArgs);
	}
	return { field, item };
}

/**
 * Emits one field value. `--raw` writes it alone, so piping a secret into a
 * consumer that reads stdin literally does not append bwx's newline to it;
 * `meta` describes the JSON envelope and so never applies on that path.
 */
function emitValue(
	value: string,
	localOpts: { raw?: boolean },
	opts: GlobalOptions,
	meta?: Record<string, unknown>,
): void {
	if (localOpts.raw) {
		emitRaw(value);
		return;
	}
	emitData(value, opts, meta);
}

/**
 * `--json` is an envelope — the value arrives quoted, escaped, and wrapped in
 * `{ "data": … }` — so its trailing newline is the least of what `--raw` would
 * have to undo. Saying so beats silently letting one win.
 */
function assertRawUsable(localOpts: { raw?: boolean }, opts: GlobalOptions): void {
	if (localOpts.raw && opts.json) {
		throw new CliError(
			"--raw and --json cannot be combined: --json wraps the value in an envelope. Use one or the other.",
			ExitCode.BadArgs,
		);
	}
}

/**
 * Emits a TOTP alongside how long it stays valid. The remainder rides in the
 * `--json` envelope's `meta` rather than replacing `data`, so `data` is still
 * the plain code every other field returns and existing parsers keep working.
 */
async function emitTotp(
	item: string,
	localOpts: GetOptions,
	opts: GlobalOptions,
	exactItemId = false,
): Promise<void> {
	if (localOpts.seed) {
		if (localOpts.fresh !== undefined) {
			throw new CliError(
				"--seed and --fresh cannot be combined: a stored secret has no window.",
				ExitCode.BadArgs,
			);
		}
		emitValue(await readTotpSecret(item, opts, exactItemId), localOpts, opts);
		return;
	}

	const totp = await readTotp(item, opts, {
		exactItemId,
		minSecondsRemaining: parseFreshSeconds(localOpts.fresh),
		onWait: (seconds) =>
			emitLog(`Waiting ${seconds}s for a fresh code…`, opts),
	});

	emitLog(`Valid for ${totp.secondsRemaining}s`, opts);
	emitValue(totp.code, localOpts, opts, {
		secondsRemaining: totp.secondsRemaining,
		period: totp.period,
	});
}

/**
 * `--fresh` is a bare flag by default and takes an explicit threshold when the
 * caller needs longer than {@link DEFAULT_FRESH_SECONDS} to use the code.
 */
function parseFreshSeconds(raw: string | boolean | undefined): number | undefined {
	if (raw === undefined || raw === false) return undefined;
	if (raw === true) return DEFAULT_FRESH_SECONDS;

	const value = Number(raw.trim());
	if (!Number.isInteger(value) || value < 0) {
		throw new CliError(
			`Invalid --fresh "${raw}". Use a non-negative integer of seconds.`,
			ExitCode.BadArgs,
		);
	}
	return value;
}

/**
 * Accepting `--fresh` on a password would read as "give me a fresh password",
 * which is not what it does. Rejecting it beats quietly ignoring it.
 */
function assertTotpOnlyFlags(field: string, localOpts: GetOptions): void {
	const used = [
		localOpts.fresh !== undefined ? "--fresh" : null,
		localOpts.seed ? "--seed" : null,
	].filter((flag): flag is string => flag !== null);

	if (used.length > 0) {
		throw new CliError(
			`${used.join(", ")} ${used.length > 1 ? "apply" : "applies"} to 'get totp', not '${field}'.`,
			ExitCode.BadArgs,
		);
	}
}

/**
 * `bwx field` took `<item> <name>` until 0.5.0. A caller using the old order
 * fails somewhere unhelpful — a missing item, or a missing field on the wrong
 * item — so say what changed rather than leaving them to guess.
 */
function withOrderHint(err: unknown): unknown {
	if (!(err instanceof CliError)) return err;

	return new CliError(
		`${err.message}\n\nNote: 'bwx field' takes <name> <item> as of 0.5.0 (it was <item> <name>).`,
		err.exitCode,
	);
}
