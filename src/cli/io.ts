import pc from "picocolors";
import { CliError, ExitCode } from "./errors.ts";
import type { GlobalOptions } from "./types.ts";

export function emitData(value: unknown, opts: GlobalOptions): void {
	if (opts.json) {
		process.stdout.write(JSON.stringify({ data: value }, null, 2) + "\n");
	} else if (opts.plain) {
		if (typeof value === "string") {
			process.stdout.write(value + "\n");
		} else if (Array.isArray(value)) {
			for (const item of value) {
				process.stdout.write(String(item) + "\n");
			}
		} else {
			process.stdout.write(JSON.stringify(value) + "\n");
		}
	} else {
		if (typeof value === "string") {
			process.stdout.write(value + "\n");
		} else {
			process.stdout.write(JSON.stringify(value, null, 2) + "\n");
		}
	}
}

export function emitLog(message: string, opts: GlobalOptions): void {
	if (opts.quiet || opts.json) return;
	process.stderr.write(message + "\n");
}

export function emitSuccess(message: string, opts: GlobalOptions): void {
	if (opts.quiet || opts.json) return;
	process.stderr.write(pc.green("✓") + " " + message + "\n");
}

export function emitWarn(message: string, opts: GlobalOptions): void {
	if (opts.quiet || opts.json) return;
	process.stderr.write(pc.yellow("⚠") + " " + message + "\n");
}

export function handleFatalError(err: unknown, opts: GlobalOptions): never {
	const cliErr =
		err instanceof CliError
			? err
			: new CliError(
					err instanceof Error ? err.message : String(err),
					ExitCode.Unknown,
				);

	if (opts.json) {
		process.stdout.write(
			JSON.stringify(
				{
					error: {
						message: cliErr.message,
						exitCode: cliErr.exitCode,
					},
				},
				null,
				2,
			) + "\n",
		);
	} else {
		process.stderr.write(pc.red("error:") + " " + cliErr.message + "\n");
		if (opts.verbose && cliErr.stack) {
			process.stderr.write(pc.dim(cliErr.stack) + "\n");
		}
	}

	process.exit(cliErr.exitCode);
}
