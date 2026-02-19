import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitSuccess } from "../io.ts";
import { CliError, ExitCode } from "../errors.ts";

export function registerConfig(program: Command): void {
	const configCmd = program
		.command("config")
		.description("Manage bwx configuration");

	configCmd
		.command("master-password")
		.description("Set master password in macOS Keychain")
		.action(async function (this: Command) {
			const opts = getGlobalOpts(this);

			let password: string;

			if (process.stdin.isTTY) {
				// Interactive prompt
				process.stderr.write("Master password: ");
				password = await readLine();
			} else {
				// Piped input
				const chunks: Uint8Array[] = [];
				for await (const chunk of Bun.stdin.stream()) {
					chunks.push(chunk);
				}
				password = Buffer.concat(chunks).toString().trim();
			}

			if (!password) {
				throw new CliError("No password provided", ExitCode.BadArgs);
			}

			const proc = Bun.spawn(
				[
					"security",
					"add-generic-password",
					"-a",
					"bitwarden",
					"-s",
					"bitwarden-master",
					"-U",
					"-w",
					password,
				],
				{ stdout: "pipe", stderr: "pipe" },
			);

			const stderr = await new Response(proc.stderr).text();
			const exitCode = await proc.exited;

			if (exitCode !== 0) {
				throw new CliError(
					`Failed to save to Keychain: ${stderr.trim()}`,
					ExitCode.Config,
				);
			}

			emitSuccess("Master password saved to Keychain", opts);
		});
}

async function readLine(): Promise<string> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of Bun.stdin.stream()) {
		chunks.push(chunk);
		const text = Buffer.concat(chunks).toString();
		if (text.includes("\n")) return text.split("\n")[0]!.trim();
	}
	return Buffer.concat(chunks).toString().trim();
}
