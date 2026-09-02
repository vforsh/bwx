import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData, emitLog } from "../io.ts";
import { BUILTIN_FIELDS, readItemField, readTotp, readTotpSecret } from "../../bw/fields.ts";
import { CARD_FIELDS } from "../../bw/cards.ts";
import { CliError, ExitCode } from "../errors.ts";
import type { GlobalOptions } from "../types.ts";

/** Seconds left below which `--fresh` waits, when the flag is given bare. */
const DEFAULT_FRESH_SECONDS = 5;

export function registerGet(program: Command): void {
	program
		.command("get")
		.description("Get a field from a vault item (built-in or custom)")
		.argument(
			"<field>",
			`Field: ${BUILTIN_FIELDS.join(" | ")} | <custom>. Card items also take: ${CARD_FIELDS.join(" | ")}`,
		)
		.argument("<item>", "Item name or ID")
		.option(
			"--fresh [seconds]",
			`Wait for the next TOTP window if fewer than N seconds remain (default ${DEFAULT_FRESH_SECONDS})`,
		)
		.option("--seed", "Emit the stored TOTP secret instead of a code")
		.action(async function (
			this: Command,
			field: string,
			item: string,
			localOpts: { fresh?: string | boolean; seed?: boolean },
		) {
			const opts = getGlobalOpts(this);

			if (field === "totp") {
				await emitTotp(item, localOpts, opts);
				return;
			}

			assertTotpOnlyFlags(field, localOpts);

			const value = await readItemField(field, item, opts);
			// `item` is the one field that is itself JSON — emit it as structure.
			emitData(field === "item" ? JSON.parse(value) : value, opts);
		});

	program
		.command("field")
		.description("Get a custom field from a vault item (never a built-in)")
		// Same order as `get`, which is the whole point of this command existing
		// alongside it — the two used to take their arguments back to front.
		.argument("<name>", "Custom field name")
		.argument("<item>", "Item name or ID")
		.action(async function (this: Command, name: string, item: string) {
			const opts = getGlobalOpts(this);
			try {
				emitData(
					await readItemField(name, item, opts, { customOnly: true }),
					opts,
				);
			} catch (err) {
				throw withOrderHint(err);
			}
		});
}

/**
 * Emits a TOTP alongside how long it stays valid. The remainder rides in the
 * `--json` envelope's `meta` rather than replacing `data`, so `data` is still
 * the plain code every other field returns and existing parsers keep working.
 */
async function emitTotp(
	item: string,
	localOpts: { fresh?: string | boolean; seed?: boolean },
	opts: GlobalOptions,
): Promise<void> {
	if (localOpts.seed) {
		if (localOpts.fresh !== undefined) {
			throw new CliError(
				"--seed and --fresh cannot be combined: a stored secret has no window.",
				ExitCode.BadArgs,
			);
		}
		emitData(await readTotpSecret(item, opts), opts);
		return;
	}

	const totp = await readTotp(item, opts, {
		minSecondsRemaining: parseFreshSeconds(localOpts.fresh),
		onWait: (seconds) =>
			emitLog(`Waiting ${seconds}s for a fresh code…`, opts),
	});

	emitLog(`Valid for ${totp.secondsRemaining}s`, opts);
	emitData(totp.code, opts, {
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
function assertTotpOnlyFlags(
	field: string,
	localOpts: { fresh?: string | boolean; seed?: boolean },
): void {
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
