import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData, emitSuccess } from "../io.ts";
import { CliError, ExitCode } from "../errors.ts";
import { runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";
import { buildNewItem, bwEncode } from "../../bw/encoding.ts";
import {
	assertSingleStdinSource,
	collect,
	listExplicitStdinInputs,
	readOptionalStdin,
	resolveFieldSources,
	resolveItemTextInputs,
	StdinReader,
	type ItemTextInputs,
} from "../input.ts";

interface CreateOptions extends ItemTextInputs {
	type: string;
	name?: string;
	username?: string;
	uri: string[];
	field: string[];
	fieldFile: string[];
	fieldEnv: string[];
	folder?: string;
	favorite?: boolean;
	fromJson?: boolean;
}

export function registerCreate(program: Command): void {
	program
		.command("create").alias("add")
		.description("Create a new vault item")
		.option("--type <type>", "Item type: login|note", "note")
		.option("--name <name>", "Item name")
		.option("--notes <text>", "Notes content")
		.option("--notes-file <path>", "Read notes from file (use - for stdin)")
		.option("--username <user>", "Username (login type)")
		.option("--password <pass>", "Password (login type)")
		.option("--password-stdin", "Read password from stdin")
		.option("--password-file <path>", "Read password from file (use - for stdin)")
		.option("--password-env <name>", "Read password from environment variable")
		.option("--uri <url>", "URI (repeatable)", collect, [])
		.option("--field <kv>", "Custom field k=v (repeatable)", collect, [])
		.option("--field-file <kv>", "Custom field value from file k=path (repeatable)", collect, [])
		.option("--field-env <kv>", "Custom field value from env var k=ENV (repeatable)", collect, [])
		.option("--folder <id>", "Folder ID")
		.option("--favorite", "Mark as favorite")
		.option("--from-json", "Read full item JSON from stdin")
		.action(async function (
			this: Command,
			localOpts: CreateOptions,
		) {
			const opts = getGlobalOpts(this);
			const stdin = new StdinReader();

			let encoded: string;

			if (localOpts.fromJson) {
				const stdinText = await stdin.read();
				if (!stdinText) {
					throw new CliError("No JSON provided on stdin", ExitCode.BadArgs);
				}
				// Validate it's JSON
				try {
					JSON.parse(stdinText);
				} catch {
					throw new CliError("Invalid JSON on stdin", ExitCode.BadArgs);
				}
				encoded = bwEncode(stdinText);
			} else {
				if (!localOpts.name) {
					throw new CliError("--name is required", ExitCode.BadArgs);
				}

				if (localOpts.type !== "login" && localOpts.type !== "note") {
					throw new CliError(
						`Invalid type "${localOpts.type}". Valid: login, note`,
						ExitCode.BadArgs,
					);
				}

				const explicitStdinSources = listExplicitStdinInputs({
					...localOpts,
					fieldFileFlag: "--field-file",
					fieldFiles: localOpts.fieldFile,
				});
				assertSingleStdinSource(explicitStdinSources);

				const textInputs = await resolveItemTextInputs(localOpts, stdin);
				let notes = textInputs.notes;

				// Backward compatibility: piped create input becomes note content.
				if (
					notes === undefined &&
					textInputs.password === undefined &&
					explicitStdinSources.length === 0 &&
					!process.stdin.isTTY
				) {
					notes = (await readOptionalStdin(stdin)) ?? undefined;
				}

				const fields = await resolveFieldSources({
					inline: localOpts.field,
					file: localOpts.fieldFile,
					env: localOpts.fieldEnv,
					fileFlag: "--field-file",
					envFlag: "--field-env",
					stdin,
				});

				const item = buildNewItem({
					type: localOpts.type,
					name: localOpts.name,
					notes: notes ?? null,
					username: localOpts.username ?? null,
					password: textInputs.password ?? null,
					uris: localOpts.uri,
					fields,
					folderId: localOpts.folder ?? null,
					favorite: localOpts.favorite ?? false,
				});

				encoded = bwEncode(JSON.stringify(item));
			}

			const result = await withSession(opts, () =>
				runBwOrThrow(["create", "item", encoded]),
			);

			const created = JSON.parse(result);
			if (opts.json) {
				emitData(created, opts);
			} else if (opts.plain) {
				emitData(created.id, opts);
			} else {
				emitSuccess(`Created "${created.name}" (${created.id})`, opts);
			}
		});
}
