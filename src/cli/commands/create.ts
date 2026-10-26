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
	loginOnlyTextInputFlags,
	readOptionalStdin,
	registerItemTextOptions,
	resolveFieldSources,
	resolveItemTextInputs,
	StdinReader,
	type ItemTextInputs,
} from "../input.ts";
import {
	assertCardIntent,
	registerCardOptions,
	resolveCardPatch,
	usedCardOnlyFlags,
	type CardOptionInputs,
} from "../card-options.ts";
import { redactGeneratedPassword } from "./generate.ts";

interface CreateOptions extends ItemTextInputs, CardOptionInputs {
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

const ITEM_TYPES = ["login", "note", "card"] as const;
type CreateItemType = (typeof ITEM_TYPES)[number];

/** Flags only a login has anywhere to store — see {@link assertTypeFlags}. */
const LOGIN_ONLY_FLAGS: Array<[keyof CreateOptions, string]> = [
	["username", "--username"],
	...loginOnlyTextInputFlags(),
];

export function registerCreate(program: Command): void {
	const command = program
		.command("create").alias("add")
		.description("Create a new vault item")
		.option("--type <type>", "Item type: login|note|card", "note")
		.option("--name <name>", "Item name")
		.option("--username <user>", "Username (login items only)");

	registerItemTextOptions(command);
	registerCardOptions(command)
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

				if (!ITEM_TYPES.includes(localOpts.type as CreateItemType)) {
					throw new CliError(
						`Invalid type "${localOpts.type}". Valid: ${ITEM_TYPES.join(", ")}`,
						ExitCode.BadArgs,
					);
				}
				const type = localOpts.type as CreateItemType;

				assertTypeFlags(localOpts, type);
				assertCardIntent(localOpts);

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
					type,
					name: localOpts.name,
					notes: notes ?? null,
					username: localOpts.username ?? null,
					password: textInputs.password ?? null,
					totp: textInputs.totp ?? null,
					uris: localOpts.uri,
					card:
						type === "card"
							? resolveCardPatch(localOpts, textInputs)
							: undefined,
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
 * `buildNewItem` writes only the object the item type has — `login` for a login,
 * `card` for a card — so any other type's values would be dropped on the floor.
 * Accepting them silently means a caller can "store" a credential, get exit 0,
 * and end up with an item that never held it.
 */
function assertTypeFlags(localOpts: CreateOptions, type: CreateItemType): void {
	const login = LOGIN_ONLY_FLAGS.filter(([key]) => Boolean(localOpts[key])).map(
		([, flag]) => flag,
	);
	if (localOpts.uri.length > 0) login.push("--uri");

	const required: Array<[CreateItemType, string[]]> = [
		["login", login],
		["card", usedCardOnlyFlags(localOpts)],
	];

	for (const [needed, used] of required) {
		if (needed === type || used.length === 0) continue;
		throw new CliError(
			`${used.join(", ")} ${used.length > 1 ? "need" : "needs"} --type ${needed} (a ${type} cannot store them).`,
			ExitCode.BadArgs,
		);
	}
}
