import { CommanderError } from "commander";
import { buildProgram } from "./cli/program.ts";
import { handleFatalError } from "./cli/io.ts";
import { CliError, ExitCode } from "./cli/errors.ts";
import type { GlobalOptions } from "./cli/types.ts";

export async function main(argv: string[]): Promise<void> {
	const program = buildProgram();

	// Bare invocation should show top-level help.
	if (argv.length <= 2) {
		program.outputHelp();
		return;
	}

	// Parse global opts early for error formatting
	const opts = parseGlobalOpts(argv.slice(2));

	try {
		await program.parseAsync(argv);
	} catch (err) {
		if (err instanceof CommanderError) {
			if (err.code === "commander.help") {
				const helpArgv = [...argv, "--help"];
				try {
					await program.parseAsync(helpArgv);
				} catch (helpErr) {
					if (
						!(
							helpErr instanceof CommanderError &&
							helpErr.code === "commander.helpDisplayed"
						)
					) {
						throw helpErr;
					}
				}
				process.exit(err.exitCode);
			}
			if (err.exitCode === 0) process.exit(0); // --help, --version
			// Commander prefixes messages with "error: " — strip it
			const msg = err.message.replace(/^error:\s*/i, "");
			handleFatalError(new CliError(msg, ExitCode.BadArgs), opts);
		}
		handleFatalError(err, opts);
	}
}

function parseGlobalOpts(args: string[]): GlobalOptions {
	return {
		json: args.includes("--json"),
		plain: args.includes("--plain"),
		quiet: args.includes("-q") || args.includes("--quiet"),
		verbose: args.includes("-v") || args.includes("--verbose"),
	};
}
