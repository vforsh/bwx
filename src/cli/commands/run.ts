import type { Command } from "commander";
import { constants } from "node:os";
import { readFields, type FieldRequest } from "../../bw/fields.ts";
import { parseFieldReference, REFERENCE_PREFIX } from "../../bw/references.ts";
import { CliError, ExitCode } from "../errors.ts";
import { collect } from "../input.ts";
import { emitLog } from "../io.ts";
import { getGlobalOpts } from "../program.ts";
import type { GlobalOptions } from "../types.ts";

/** `NAME=<field>:<item>` or `NAME=<ref>` — one secret for the child's environment. */
export interface EnvSpec extends FieldRequest {
	name: string;
}

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const SPEC_HINT = "Expected --env NAME=<field>:<item> or NAME=<ref>, e.g. --env DB_PASS=password:'Prod DB'";

export function registerRun(program: Command): void {
	program
		.command("run")
		.description("Run a command with secrets injected into its environment")
		.argument("<command...>", "Command to run — use -- before it if it takes its own flags")
		.option(
			"--env <spec>",
			"Inject a secret as NAME=<field>:<item> or NAME=<ref> (repeatable)",
			collect,
			[],
		)
		.action(async function (
			this: Command,
			command: string[],
			localOpts: { env: string[] },
		) {
			const opts = getGlobalOpts(this);
			const specs = parseEnvSpecs(localOpts.env);

			const secrets = await resolveSecrets(specs, opts);

			// Only the names are ever logged; values exist solely in the child env.
			if (opts.verbose) {
				emitLog(`Injecting ${specs.map((s) => s.name).join(", ")}`, opts);
			}

			process.exit(await spawnChild(command, secrets));
		});
}

/** Parses every `--env` flag, rejecting bad specs before any vault access. */
export function parseEnvSpecs(raws: string[]): EnvSpec[] {
	if (raws.length === 0) {
		throw new CliError(`No secrets requested. ${SPEC_HINT}`, ExitCode.BadArgs);
	}

	const specs = raws.map(parseEnvSpec);

	const seen = new Set<string>();
	for (const spec of specs) {
		if (seen.has(spec.name)) {
			throw new CliError(`Duplicate --env name "${spec.name}"`, ExitCode.BadArgs);
		}
		seen.add(spec.name);
	}

	return specs;
}

/**
 * Splits `NAME=<field>:<item>` on the first `=` and then the first `:`, so item
 * names may contain colons (`password:http://my.router`) while field names may not.
 * Fields resolve exactly as in `bwx get`: built-ins first, then card fields on a card
 * item, otherwise custom fields. A bwx:// reference supplies an exact ID and an
 * explicit field kind, bypassing the legacy colon-separated grammar.
 */
export function parseEnvSpec(raw: string): EnvSpec {
	const eq = raw.indexOf("=");
	if (eq <= 0) {
		throw new CliError(`Invalid --env "${raw}". ${SPEC_HINT}`, ExitCode.BadArgs);
	}

	const name = raw.slice(0, eq);
	if (!ENV_NAME_RE.test(name)) {
		throw new CliError(
			`Invalid environment variable name "${name}". Use letters, digits, and underscores.`,
			ExitCode.BadArgs,
		);
	}

	const ref = raw.slice(eq + 1);
	if (ref.startsWith(REFERENCE_PREFIX)) {
		return { name, ...parseFieldReference(ref) };
	}
	const colon = ref.indexOf(":");
	if (colon <= 0 || colon === ref.length - 1) {
		throw new CliError(`Invalid --env "${raw}". ${SPEC_HINT}`, ExitCode.BadArgs);
	}

	return { name, field: ref.slice(0, colon), item: ref.slice(colon + 1) };
}

/**
 * Resolves every secret, paying one `bw` spawn per distinct *item* rather than
 * per variable — pulling a username and password from the same item is a single
 * vault read.
 */
async function resolveSecrets(
	specs: EnvSpec[],
	opts: GlobalOptions,
): Promise<Record<string, string>> {
	const values = await readFields(specs, opts);

	return Object.fromEntries(
		specs.map((spec, index) => [spec.name, values[index]!]),
	);
}

/**
 * Runs the child with inherited stdio so it stays usable interactively, and
 * mirrors its exit status (`128 + signal` when it was killed, as shells do).
 */
async function spawnChild(
	command: string[],
	secrets: Record<string, string>,
): Promise<number> {
	let proc;
	try {
		proc = Bun.spawn(command, {
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
			env: { ...process.env, ...secrets },
		});
	} catch {
		// Spawn diagnostics may quote the environment that already holds secrets.
		throw new CliError(
			"Failed to run requested command. Check the executable and environment.",
			ExitCode.BadArgs,
		);
	}

	const exitCode = await proc.exited;
	const signal = proc.signalCode;
	return signal ? 128 + constants.signals[signal] : exitCode;
}
