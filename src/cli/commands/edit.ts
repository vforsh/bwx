import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData, emitSuccess } from "../io.ts";
import { CliError, ExitCode } from "../errors.ts";
import { runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";
import { patchItem, bwEncode } from "../../bw/encoding.ts";
import {
	assertSingleStdinSource,
	collect,
	listExplicitStdinInputs,
	resolveFieldSources,
	resolveItemTextInputs,
	StdinReader,
	type ItemTextInputs,
} from "../input.ts";

interface EditOptions extends ItemTextInputs {
	name?: string;
	username?: string;
	uri: string[];
	addField: string[];
	addFieldFile: string[];
	addFieldEnv: string[];
	rmField: string[];
	folder?: string;
	favorite?: boolean;
	fromJson?: boolean;
}

export function registerEdit(program: Command): void {
	program
		.command("edit")
		.description("Edit an existing vault item")
		.argument("<item>", "Item name or ID")
		.option("--name <name>", "New name")
		.option("--notes <text>", "New notes")
		.option("--notes-file <path>", "Read notes from file (use - for stdin)")
		.option("--username <user>", "New username")
		.option("--password <pass>", "New password")
		.option("--password-stdin", "Read password from stdin")
		.option("--password-file <path>", "Read password from file (use - for stdin)")
		.option("--password-env <name>", "Read password from environment variable")
		.option("--uri <url>", "Set URIs (repeatable, replaces all)", collect, [])
		.option("--add-field <kv>", "Add/update field k=v", collect, [])
		.option("--add-field-file <kv>", "Add/update field value from file k=path", collect, [])
		.option("--add-field-env <kv>", "Add/update field value from env var k=ENV", collect, [])
		.option("--rm-field <name>", "Remove field by name", collect, [])
		.option("--folder <id>", "Move to folder")
		.option("--favorite", "Set favorite")
		.option("--no-favorite", "Unset favorite")
		.option("--from-json", "Read full item JSON from stdin (replaces item)")
		.action(async function (
			this: Command,
			item: string,
			localOpts: EditOptions,
		) {
			const opts = getGlobalOpts(this);
			const stdin = new StdinReader();

			const result = await withSession(opts, async () => {
				// Fetch current item
				const json = await runBwOrThrow(["get", "item", item]);
				const current = JSON.parse(json);
				const itemId = current.id;

				let encoded: string;

				if (localOpts.fromJson) {
					const stdinText = await stdin.read();
					if (!stdinText) {
						throw new CliError("No JSON provided on stdin", ExitCode.BadArgs);
					}
					encoded = bwEncode(stdinText);
				} else {
					assertSingleStdinSource(
						listExplicitStdinInputs({
							...localOpts,
							fieldFileFlag: "--add-field-file",
							fieldFiles: localOpts.addFieldFile,
						}),
					);

					const textInputs = await resolveItemTextInputs(localOpts, stdin);

					const addFields = await resolveFieldSources({
						inline: localOpts.addField,
						file: localOpts.addFieldFile,
						env: localOpts.addFieldEnv,
						fileFlag: "--add-field-file",
						envFlag: "--add-field-env",
						stdin,
					});

					const patched = patchItem(current, {
						name: localOpts.name,
						notes: textInputs.notes,
						username: localOpts.username,
						password: textInputs.password,
						uris: localOpts.uri.length > 0 ? localOpts.uri : undefined,
						addFields,
						rmFields: localOpts.rmField,
						folderId: localOpts.folder,
						favorite: localOpts.favorite,
					});
					encoded = bwEncode(JSON.stringify(patched));
				}

				return runBwOrThrow(["edit", "item", itemId, encoded]);
			});

			const updated = JSON.parse(result);
			if (opts.json) {
				emitData(updated, opts);
			} else if (opts.plain) {
				emitData(updated.id, opts);
			} else {
				emitSuccess(`Updated "${updated.name}" (${updated.id})`, opts);
			}
		});
}
