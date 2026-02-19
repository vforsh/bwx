import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData, emitSuccess } from "../io.ts";
import { CliError, ExitCode } from "../errors.ts";
import { runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";
import { patchItem, parseFieldFlag, bwEncode } from "../../bw/encoding.ts";

function collect(val: string, prev: string[]): string[] {
	prev.push(val);
	return prev;
}

export function registerEdit(program: Command): void {
	program
		.command("edit")
		.description("Edit an existing vault item")
		.argument("<item>", "Item name or ID")
		.option("--name <name>", "New name")
		.option("--notes <text>", "New notes")
		.option("--username <user>", "New username")
		.option("--password <pass>", "New password")
		.option("--uri <url>", "Set URIs (repeatable, replaces all)", collect, [])
		.option("--add-field <kv>", "Add/update field k=v", collect, [])
		.option("--rm-field <name>", "Remove field by name", collect, [])
		.option("--folder <id>", "Move to folder")
		.option("--favorite", "Set favorite")
		.option("--no-favorite", "Unset favorite")
		.option("--from-json", "Read full item JSON from stdin (replaces item)")
		.action(async function (
			this: Command,
			item: string,
			localOpts: {
				name?: string;
				notes?: string;
				username?: string;
				password?: string;
				uri: string[];
				addField: string[];
				rmField: string[];
				folder?: string;
				favorite?: boolean;
				fromJson?: boolean;
			},
		) {
			const opts = getGlobalOpts(this);

			const result = await withSession(opts, async () => {
				// Fetch current item
				const json = await runBwOrThrow(["get", "item", item]);
				const current = JSON.parse(json);
				const itemId = current.id;

				let encoded: string;

				if (localOpts.fromJson) {
					const chunks: Uint8Array[] = [];
					for await (const chunk of Bun.stdin.stream()) {
						chunks.push(chunk);
					}
					const stdinText = Buffer.concat(chunks).toString().trim();
					if (!stdinText) {
						throw new CliError("No JSON provided on stdin", ExitCode.BadArgs);
					}
					encoded = bwEncode(stdinText);
				} else {
					const patched = patchItem(current, {
						name: localOpts.name,
						notes: localOpts.notes,
						username: localOpts.username,
						password: localOpts.password,
						uris: localOpts.uri.length > 0 ? localOpts.uri : undefined,
						addFields: localOpts.addField.map(parseFieldFlag),
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
