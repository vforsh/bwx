import { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { DEFAULT_TIMEOUT_MS, setBwTimeout } from "../bw/runner.ts";
import { formatDuration, parseDuration } from "./duration.ts";
import type { GlobalOptions } from "./types.ts";
import { registerGet } from "./commands/get.ts";
import { registerSearch } from "./commands/search.ts";
import { registerCreate } from "./commands/create.ts";
import { registerEdit } from "./commands/edit.ts";
import { registerDelete } from "./commands/delete.ts";
import { registerStatus } from "./commands/status.ts";
import { registerSync } from "./commands/sync.ts";
import { registerUnlock } from "./commands/unlock.ts";
import { registerLock } from "./commands/lock.ts";
import { registerConfig } from "./commands/config.ts";
import { registerDoctor } from "./commands/doctor.ts";
import { registerList } from "./commands/list.ts";
import { registerAttach } from "./commands/attach.ts";
import { registerRun } from "./commands/run.ts";
import { registerGenerate } from "./commands/generate.ts";
import { registerFolders } from "./commands/folders.ts";
import { registerTrash } from "./commands/trash.ts";

export function buildProgram(): Command {
	const program = new Command();

	program
		.name("bwx")
		.description("Bitwarden Extended CLI")
		.version(pkg.version)
		.option("--json", "JSON output")
		.option("--plain", "Plain parseable output")
		.option("-q, --quiet", "Suppress log output")
		.option("-v, --verbose", "Verbose output")
		.option(
			"--timeout <duration>",
			"Deadline for each bw call, 0 to disable",
			formatDuration(DEFAULT_TIMEOUT_MS),
		)
		.option(
			"--sync-if-older-than <duration>",
			"Sync first when the vault last synced longer ago than this",
		)
		.exitOverride()
		.configureOutput({
			writeOut: (str) => process.stdout.write(str),
			writeErr: () => {}, // silenced — we handle all errors in main()
		})
		// Global options that configure the runtime are applied once, before any
		// command action runs.
		.hook("preAction", (_program, actionCommand) => {
			setBwTimeout(getGlobalOpts(actionCommand).timeoutMs ?? DEFAULT_TIMEOUT_MS);
		});

	registerStatus(program);
	registerUnlock(program);
	registerLock(program);
	registerGet(program);
	registerSearch(program);
	registerRun(program);
	registerSync(program);
	registerCreate(program);
	registerEdit(program);
	registerDelete(program);
	registerTrash(program);
	registerAttach(program);
	registerList(program);
	registerFolders(program);
	registerGenerate(program);
	registerConfig(program);
	registerDoctor(program);

	return program;
}

export function getGlobalOpts(cmd: Command): GlobalOptions {
	const root = cmd.optsWithGlobals();
	return {
		json: root.json ?? false,
		plain: root.plain ?? false,
		quiet: root.quiet ?? false,
		verbose: root.verbose ?? false,
		timeoutMs: optionalDuration(root.timeout, "--timeout") ?? DEFAULT_TIMEOUT_MS,
		syncIfOlderThanMs: optionalDuration(
			root.syncIfOlderThan,
			"--sync-if-older-than",
		),
	};
}

function optionalDuration(
	raw: string | undefined,
	flag: string,
): number | undefined {
	return raw === undefined ? undefined : parseDuration(raw, flag);
}
