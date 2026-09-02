import pc from "picocolors";
import { CliError, ExitCode } from "./errors.ts";
import type { GlobalOptions } from "./types.ts";

/**
 * `meta` rides along in the JSON envelope for facts about the response itself
 * (truncation, counts) that a machine caller cannot recover from `data` alone.
 * It is omitted entirely when absent, so `{ data }` stays the stable shape.
 */
export function emitData(
	value: unknown,
	opts: GlobalOptions,
	meta?: Record<string, unknown>,
): void {
	if (opts.json) {
		const payload = meta ? { data: value, meta } : { data: value };
		process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
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

/**
 * Writes a value and nothing else — no newline, no formatting. {@link emitData}'s
 * newline is a courtesy to terminals, but a consumer that reads stdin literally
 * takes it as the last byte of the secret. Newlines *inside* the value are the
 * value's own and are left alone.
 */
export function emitRaw(value: string): void {
	process.stdout.write(value);
}

export function emitLog(message: string, opts: GlobalOptions): void {
	if (opts.quiet || opts.json) return;
	process.stderr.write(message + "\n");
}

export function emitSuccess(message: string, opts: GlobalOptions): void {
	if (opts.quiet || opts.json) return;
	process.stderr.write(pc.green("✓") + " " + message + "\n");
}

/**
 * Warnings say the returned data may be wrong (stale vault, rejected session
 * cache), so unlike logs they survive `--json` — the machine-readable callers are
 * the ones that most need to hear it. Still stderr-only, so stdout stays
 * parseable; `-q` is the way to silence them.
 */
export function emitWarn(message: string, opts: GlobalOptions): void {
	if (opts.quiet) return;
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
