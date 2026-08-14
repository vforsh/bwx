import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData } from "../io.ts";
import { readItemField } from "../../bw/fields.ts";

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
		.description("Get a custom field from a vault item")
		.argument("<item>", "Item name or ID")
		.argument("<name>", "Custom field name")
		.action(async function (this: Command, item: string, name: string) {
			const opts = getGlobalOpts(this);
			emitData(await readItemField(name, item, opts, { customOnly: true }), opts);
		});
}
