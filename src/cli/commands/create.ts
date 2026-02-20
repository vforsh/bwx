import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData, emitSuccess } from "../io.ts";
import { CliError, ExitCode } from "../errors.ts";
import { runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";
import { buildNewItem, parseFieldFlag, bwEncode } from "../../bw/encoding.ts";

function collect(val: string, prev: string[]): string[] {
	prev.push(val);
	return prev;
}

export function registerCreate(program: Command): void {
	program
		.command("create").alias("add")
		.description("Create a new vault item")
		.option("--type <type>", "Item type: login|note", "note")
		.option("--name <name>", "Item name")
		.option("--notes <text>", "Notes content")
		.option("--username <user>", "Username (login type)")
		.option("--password <pass>", "Password (login type)")
		.option("--uri <url>", "URI (repeatable)", collect, [])
		.option("--field <kv>", "Custom field k=v (repeatable)", collect, [])
		.option("--folder <id>", "Folder ID")
		.option("--favorite", "Mark as favorite")
		.option("--from-json", "Read full item JSON from stdin")
		.action(async function (
			this: Command,
			localOpts: {
				type: string;
				name?: string;
				notes?: string;
				username?: string;
				password?: string;
				uri: string[];
				field: string[];
				folder?: string;
				favorite?: boolean;
				fromJson?: boolean;
			},
		) {
			const opts = getGlobalOpts(this);

			let encoded: string;

			if (localOpts.fromJson) {
				const stdin = await readStdin();
				if (!stdin) {
					throw new CliError("No JSON provided on stdin", ExitCode.BadArgs);
				}
				// Validate it's JSON
				try {
					JSON.parse(stdin);
				} catch {
					throw new CliError("Invalid JSON on stdin", ExitCode.BadArgs);
				}
				encoded = bwEncode(stdin);
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

				// Read notes from stdin if not provided and not a TTY
				let notes = localOpts.notes ?? null;
				if (notes === null && !process.stdin.isTTY) {
					const stdinText = await readStdin();
					if (stdinText) notes = stdinText;
				}

				// Read password from stdin if not provided, login type, and not a TTY
				let password = localOpts.password ?? null;
				if (
					password === null &&
					localOpts.type === "login" &&
					!process.stdin.isTTY &&
					notes === null
				) {
					const stdinText = await readStdin();
					if (stdinText) password = stdinText;
				}

				const fields = localOpts.field.map(parseFieldFlag);

				const item = buildNewItem({
					type: localOpts.type,
					name: localOpts.name,
					notes,
					username: localOpts.username ?? null,
					password,
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

async function readStdin(): Promise<string | null> {
	try {
		const chunks: Uint8Array[] = [];
		for await (const chunk of Bun.stdin.stream()) {
			chunks.push(chunk);
		}
		const text = Buffer.concat(chunks).toString().trim();
		return text || null;
	} catch {
		return null;
	}
}
