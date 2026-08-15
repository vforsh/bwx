import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData } from "../io.ts";
import { readItemField } from "../../bw/fields.ts";
import { CliError } from "../errors.ts";

export function registerGet(program: Command): void {
	program
		.command("get")
		.description("Get a field from a vault item (built-in or custom)")
		.argument("<field>", "Field: password | username | totp | notes | uri | item | <custom>")
		.argument("<item>", "Item name or ID")
		.action(async function (this: Command, field: string, item: string) {
			const opts = getGlobalOpts(this);
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
