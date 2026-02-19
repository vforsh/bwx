import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData } from "../io.ts";
import { CliError, ExitCode } from "../errors.ts";
import { runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";
import { BwItemSchema } from "../../bw/types.ts";

export function registerField(program: Command): void {
	program
		.command("field")
		.description("Get a custom field from a vault item")
		.argument("<item>", "Item name or ID")
		.argument("<field-name>", "Custom field name")
		.action(async function (this: Command, item: string, fieldName: string) {
			const opts = getGlobalOpts(this);

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

			emitData(match.value ?? "", opts);
		});
}
