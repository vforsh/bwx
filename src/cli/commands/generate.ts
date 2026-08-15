import type { Command } from "commander";
import { generateSecret, type GenerateOptions } from "../../bw/generate.ts";
import { CliError, ExitCode } from "../errors.ts";
import { emitData } from "../io.ts";
import { getGlobalOpts } from "../program.ts";

export function registerGenerate(program: Command): void {
	program
		.command("generate").alias("gen")
		.description("Generate a password or passphrase (local, no vault access)")
		.option("--length <n>", "Password length", parsePositiveInt("--length"))
		.option("--no-uppercase", "Exclude uppercase letters")
		.option("--no-lowercase", "Exclude lowercase letters")
		.option("--no-numbers", "Exclude digits")
		.option("-s, --special", "Include special characters")
		.option("--ambiguous", "Allow ambiguous characters")
		.option("--passphrase", "Generate a passphrase instead")
		.option("--words <n>", "Words in the passphrase", parsePositiveInt("--words"))
		.option("--separator <char>", "Passphrase word separator")
		.option("--capitalize", "Capitalize passphrase words")
		.option("--include-number", "Include a number in the passphrase")
		.action(async function (this: Command, localOpts: GenerateOptions) {
			const opts = getGlobalOpts(this);
			emitData(await generateSecret(localOpts), opts);
		});
}

/**
 * Strips a password bwx generated out of the echoed item. The entire point of
 * `--password-generate` is that the value goes to the vault without passing
 * through the caller's terminal, transcript, or logs — echoing it back in the
 * `--json` result would hand it straight back.
 */
export function redactGeneratedPassword(
	item: Record<string, unknown>,
	generated: boolean,
): Record<string, unknown> {
	if (!generated) return item;

	const login = item.login as Record<string, unknown> | null | undefined;
	if (!login) return item;

	return { ...item, login: { ...login, password: "***GENERATED***" } };
}

function parsePositiveInt(flag: string): (raw: string) => number {
	return (raw: string) => {
		const value = Number(raw);
		if (!Number.isInteger(value) || value <= 0) {
			throw new CliError(
				`Invalid ${flag} "${raw}". Use a positive integer.`,
				ExitCode.BadArgs,
			);
		}
		return value;
	};
}
