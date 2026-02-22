import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData, emitSuccess } from "../io.ts";
import { CliError, ExitCode } from "../errors.ts";
import {
	getConfigPath,
	loadConfig,
	saveConfig,
} from "../../config/store.ts";

export function registerConfig(program: Command): void {
	const configCmd = program
		.command("config").alias("cfg")
		.description("Manage bwx configuration");

	configCmd
		.command("email")
		.description("Set Bitwarden account email")
		.argument("[email]", "Account email address")
		.action(async function (this: Command, email?: string) {
			const opts = getGlobalOpts(this);

			if (!email) {
				if (!process.stdin.isTTY) {
					throw new CliError(
						"Pass email as argument when piping",
						ExitCode.BadArgs,
					);
				}
				process.stderr.write("Email: ");
				email = await readLine();
			}

			if (!email) {
				throw new CliError("Email is required", ExitCode.BadArgs);
			}

			const config = await loadConfig();
			config.email = email;
			await saveConfig(config);

			emitSuccess("Email saved", opts);
		});

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

	configCmd
		.command("list").alias("ls")
		.description("Show config file path and redacted content")
		.action(async function (this: Command) {
			const opts = getGlobalOpts(this);
			const path = getConfigPath();
			const file = Bun.file(path);
			const exists = await file.exists();
			let config: unknown = null;

			if (exists) {
				try {
					config = JSON.parse(await file.text());
				} catch (err) {
					throw new CliError(
						`Config file is not valid JSON: ${
							err instanceof Error ? err.message : String(err)
						}`,
						ExitCode.Config,
					);
				}
			}

			emitData(
				{
					path,
					exists,
					config: redactSensitive(config),
				},
				opts,
			);
		});
}

const SENSITIVE_KEY_RE = [
	/pass(word)?/i,
	/secret/i,
	/token/i,
	/api[-_]?key/i,
	/private/i,
	/credential/i,
	/session/i,
	/auth/i,
	/totp/i,
];

function redactSensitive(value: unknown): unknown {
	if (!value || typeof value !== "object") {
		return value;
	}

	if (Array.isArray(value)) {
		return value.map((item) => redactSensitive(item));
	}

	const out: Record<string, unknown> = {};
	for (const [key, current] of Object.entries(value)) {
		out[key] = isSensitiveKey(key) ? "***REDACTED***" : redactSensitive(current);
	}

	return out;
}

function isSensitiveKey(key: string): boolean {
	return SENSITIVE_KEY_RE.some((pattern) => pattern.test(key));
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
