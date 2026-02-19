import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData } from "../io.ts";
import { handleFatalError } from "../io.ts";
import { CliError, ExitCode } from "../errors.ts";
import { runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";

const VALID_FIELDS = ["password", "username", "totp", "notes", "uri", "item"];

export function registerGet(program: Command): void {
	program
		.command("get")
		.description("Get a field from a vault item")
		.argument("<field>", `Field: ${VALID_FIELDS.join(" | ")}`)
		.argument("<item>", "Item name or ID")
		.action(async function (this: Command, field: string, item: string) {
			const opts = getGlobalOpts(this);

			if (!VALID_FIELDS.includes(field)) {
				throw new CliError(
					`Invalid field "${field}". Valid: ${VALID_FIELDS.join(", ")}`,
					ExitCode.BadArgs,
				);
			}

			const result = await withSession(opts, async () => {
				if (field === "item") {
					return runBwOrThrow(["get", "item", item]);
				}
				return runBwOrThrow(["get", field, item]);
			});

			if (!result) {
				throw new CliError(
					`No ${field} found for item: ${item}`,
					ExitCode.NotFound,
				);
			}

			if (field === "item") {
				emitData(JSON.parse(result), opts);
			} else {
				emitData(result, opts);
			}
		});
}
