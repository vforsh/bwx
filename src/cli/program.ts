import { Command } from "commander";
import type { GlobalOptions } from "./types.ts";
import { registerGet } from "./commands/get.ts";
import { registerField } from "./commands/field.ts";
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

export function buildProgram(): Command {
	const program = new Command();

	program
		.name("bwx")
		.description("Bitwarden Extended CLI")
		.version("0.1.0")
		.option("--json", "JSON output")
		.option("--plain", "Plain parseable output")
		.option("-q, --quiet", "Suppress log output")
		.option("-v, --verbose", "Verbose output")
		.exitOverride()
		.configureOutput({
			writeOut: (str) => process.stdout.write(str),
			writeErr: () => {}, // silenced — we handle all errors in main()
		});

	registerStatus(program);
	registerUnlock(program);
	registerLock(program);
	registerGet(program);
	registerField(program);
	registerSearch(program);
	registerSync(program);
	registerCreate(program);
	registerEdit(program);
	registerDelete(program);
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
	};
}
