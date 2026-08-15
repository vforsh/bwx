import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData, emitSuccess } from "../io.ts";
import { CliError, ExitCode } from "../errors.ts";
import { runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";
import { buildNewItem, bwEncode } from "../../bw/encoding.ts";
import { generateSecret } from "../../bw/generate.ts";
import { resolveFolderRef } from "../../bw/folders.ts";
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
import { redactGeneratedPassword } from "./generate.ts";

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
	generateLength?: number;
}

/** Flags a secure note has nowhere to store — see {@link assertLoginFlags}. */
const LOGIN_ONLY_FLAGS: Array<[keyof CreateOptions, string]> = [
	["username", "--username"],
	["password", "--password"],
	["passwordStdin", "--password-stdin"],
	["passwordFile", "--password-file"],
	["passwordEnv", "--password-env"],
	["passwordGenerate", "--password-generate"],
	["totp", "--totp"],
	["totpStdin", "--totp-stdin"],
	["totpFile", "--totp-file"],
	["totpEnv", "--totp-env"],
];

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
		.option("--password-generate", "Generate the password; it is never printed")
		.option("--generate-length <n>", "Length for --password-generate", parseInt)
		.option("--totp <secret>", "TOTP secret: base32 or otpauth:// URI (login type)")
		.option("--totp-stdin", "Read the TOTP secret from stdin")
		.option("--totp-file <path>", "Read the TOTP secret from file (use - for stdin)")
		.option("--totp-env <name>", "Read the TOTP secret from environment variable")
		.option("--uri <url>", "URI (repeatable)", collect, [])
		.option("--field <kv>", "Custom field k=v (repeatable)", collect, [])
		.option("--field-file <kv>", "Custom field value from file k=path (repeatable)", collect, [])
		.option("--field-env <kv>", "Custom field value from env var k=ENV (repeatable)", collect, [])
		.option("--folder <name|id>", "Folder name or ID")
		.option("--favorite", "Mark as favorite")
		.option("--from-json", "Read full item JSON from stdin")
		.action(async function (
			this: Command,
			localOpts: CreateOptions,
		) {
			const opts = getGlobalOpts(this);
			const stdin = new StdinReader();

			let encoded: string;
			let generated = false;

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

				assertLoginFlags(localOpts);

				const explicitStdinSources = listExplicitStdinInputs({
					...localOpts,
					fieldFileFlag: "--field-file",
					fieldFiles: localOpts.fieldFile,
				});
				assertSingleStdinSource(explicitStdinSources);

				const textInputs = await resolveItemTextInputs(localOpts, stdin, () =>
					generateSecret({ length: localOpts.generateLength }),
				);
				generated = textInputs.passwordGenerated ?? false;
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
					totp: textInputs.totp ?? null,
					uris: localOpts.uri,
					fields,
					folderId: localOpts.folder
						? await resolveFolderRef(localOpts.folder, opts)
						: null,
					favorite: localOpts.favorite ?? false,
				});

				encoded = bwEncode(JSON.stringify(item));
			}

			const result = await withSession(opts, () =>
				runBwOrThrow(["create", "item", encoded]),
			);

			const created = JSON.parse(result);
			if (opts.json) {
				emitData(redactGeneratedPassword(created, generated), opts);
			} else if (opts.plain) {
				emitData(created.id, opts);
			} else {
				const note = generated ? " — password generated (not printed)" : "";
				emitSuccess(`Created "${created.name}" (${created.id})${note}`, opts);
			}
		});
}

/**
 * A secure note has no login object, so `buildNewItem` drops usernames,
 * passwords, and URIs on the floor. Accepting them silently means a caller can
 * "store" a credential, get exit 0, and end up with an item that never held it.
 */
function assertLoginFlags(localOpts: CreateOptions): void {
	if (localOpts.type === "login") return;

	const used = LOGIN_ONLY_FLAGS.filter(([key]) => Boolean(localOpts[key])).map(
		([, flag]) => flag,
	);
	if (localOpts.uri.length > 0) used.push("--uri");

	if (used.length > 0) {
		throw new CliError(
			`${used.join(", ")} ${used.length > 1 ? "need" : "needs"} --type login (a note cannot store them).`,
			ExitCode.BadArgs,
		);
	}
}
