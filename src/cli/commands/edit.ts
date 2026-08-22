import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData, emitSuccess } from "../io.ts";
import { CliError, ExitCode } from "../errors.ts";
import { runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";
import { patchItem, bwEncode } from "../../bw/encoding.ts";
import { generateSecret } from "../../bw/generate.ts";
import { resolveFolderRef } from "../../bw/folders.ts";
import { BwItemType } from "../../bw/types.ts";
import {
	assertSingleStdinSource,
	collect,
	listExplicitStdinInputs,
	listUsedSourceFlags,
	loginOnlyTextInputFlags,
	registerItemTextOptions,
	resolveFieldSources,
	resolveItemTextInputs,
	StdinReader,
	TOTP_FAMILY,
	type ItemTextInputs,
} from "../input.ts";
import { redactGeneratedPassword } from "./generate.ts";

interface EditOptions extends ItemTextInputs {
	name?: string;
	username?: string;
	uri: string[];
	addField: string[];
	addFieldFile: string[];
	addFieldEnv: string[];
	rmField: string[];
	rmTotp?: boolean;
	folder?: string;
	favorite?: boolean;
	fromJson?: boolean;
	generateLength?: number;
}

const LOGIN_ONLY_FLAGS: Array<[keyof EditOptions, string]> = [
	["username", "--username"],
	...loginOnlyTextInputFlags(),
	["rmTotp", "--rm-totp"],
];

export function registerEdit(program: Command): void {
	const command = program
		.command("edit")
		.description("Edit an existing vault item")
		.argument("<item>", "Item name or ID")
		.option("--name <name>", "New name")
		.option("--username <user>", "New username");

	registerItemTextOptions(command)
		.option("--rm-totp", "Remove the stored TOTP secret")
		.option("--uri <url>", "Set URIs (repeatable, replaces all)", collect, [])
		.option("--add-field <kv>", "Add/update field k=v", collect, [])
		.option("--add-field-file <kv>", "Add/update field value from file k=path", collect, [])
		.option("--add-field-env <kv>", "Add/update field value from env var k=ENV", collect, [])
		.option("--rm-field <name>", "Remove field by name", collect, [])
		.option("--folder <name|id>", "Move to folder ('none' to unfile)")
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
			let generated = false;

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
					assertLoginFlags(localOpts, current);
					assertTotpIntent(localOpts);

					assertSingleStdinSource(
						listExplicitStdinInputs({
							...localOpts,
							fieldFileFlag: "--add-field-file",
							fieldFiles: localOpts.addFieldFile,
						}),
					);

					const textInputs = await resolveItemTextInputs(localOpts, stdin, () =>
						generateSecret({ length: localOpts.generateLength }),
					);
					generated = textInputs.passwordGenerated ?? false;

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
						totp: localOpts.rmTotp ? null : textInputs.totp,
						uris: localOpts.uri.length > 0 ? localOpts.uri : undefined,
						addFields,
						rmFields: localOpts.rmField,
						folderId: localOpts.folder
							? await resolveFolderRef(localOpts.folder, opts)
							: undefined,
						favorite: localOpts.favorite,
					});
					encoded = bwEncode(JSON.stringify(patched));
				}

				return runBwOrThrow(["edit", "item", itemId, encoded]);
			});

			const updated = JSON.parse(result);
			if (opts.json) {
				emitData(redactGeneratedPassword(updated, generated), opts);
			} else if (opts.plain) {
				emitData(updated.id, opts);
			} else {
				const note = generated ? " — password generated (not printed)" : "";
				emitSuccess(`Updated "${updated.name}" (${updated.id})${note}`, opts);
			}
		});
}

/**
 * Setting and clearing the same secret in one call has no sensible winner, and
 * picking one silently would either drop a seed or fail to remove one.
 */
function assertTotpIntent(localOpts: EditOptions): void {
	if (!localOpts.rmTotp) return;

	const setters = listUsedSourceFlags(TOTP_FAMILY, localOpts);

	if (setters.length > 0) {
		throw new CliError(
			`--rm-totp cannot be combined with ${setters.join(", ")}.`,
			ExitCode.BadArgs,
		);
	}
}

/**
 * Same trap as `create`: only a login item has somewhere to put a password, so
 * setting one on a note would be accepted and then quietly lost.
 */
function assertLoginFlags(
	localOpts: EditOptions,
	current: Record<string, unknown>,
): void {
	if (current.type === BwItemType.Login) return;

	const used = LOGIN_ONLY_FLAGS.filter(([key]) => Boolean(localOpts[key])).map(
		([, flag]) => flag,
	);
	if (localOpts.uri.length > 0) used.push("--uri");

	if (used.length === 0) return;

	throw new CliError(
		`${used.join(", ")} ${used.length > 1 ? "need" : "needs"} a login item, but "${String(current.name)}" is not one.`,
		ExitCode.BadArgs,
	);
}
