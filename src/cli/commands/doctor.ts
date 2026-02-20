import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData } from "../io.ts";
import { loadConfig } from "../../config/store.ts";
import pc from "picocolors";

interface Check {
	name: string;
	ok: boolean;
	detail?: string;
	fix?: string;
}

export function registerDoctor(program: Command): void {
	program
		.command("doctor").alias("check")
		.description("Check if bwx is ready to use")
		.action(async function (this: Command) {
			const opts = getGlobalOpts(this);
			const checks: Check[] = [];

			// 1. bw CLI installed
			checks.push(await checkBwInstalled());

			// 2. bw CLI version
			if (checks[0]!.ok) {
				checks.push(await checkBwVersion());
			}

			// 3. Email configured
			checks.push(await checkEmail());

			// 4. Master password in Keychain
			checks.push(await checkMasterPassword());

			// 5. Config dir writable
			checks.push(await checkConfigDir());

			if (opts.json || opts.plain) {
				emitData(checks, opts);
				return;
			}

			for (const check of checks) {
				const icon = check.ok ? pc.green("✓") : pc.red("✗");
				const name = check.ok ? check.name : pc.red(check.name);
				let line = `${icon} ${name}`;
				if (check.detail) {
					line += pc.dim(` (${check.detail})`);
				}
				process.stderr.write(line + "\n");
				if (!check.ok && check.fix) {
					process.stderr.write(pc.dim(`  → ${check.fix}`) + "\n");
				}
			}

			const failed = checks.filter((c) => !c.ok).length;
			if (failed > 0) {
				process.stderr.write(
					"\n" + pc.red(`${failed} issue${failed > 1 ? "s" : ""} found`) + "\n",
				);
				process.exit(1);
			} else {
				process.stderr.write("\n" + pc.green("All good") + "\n");
			}
		});
}

async function checkBwInstalled(): Promise<Check> {
	try {
		const proc = Bun.spawn(["which", "bw"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const path = (await new Response(proc.stdout).text()).trim();
		const code = await proc.exited;
		if (code === 0 && path) {
			return { name: "Bitwarden CLI", ok: true, detail: path };
		}
	} catch {}
	return {
		name: "Bitwarden CLI",
		ok: false,
		fix: "brew install bitwarden-cli",
	};
}

async function checkBwVersion(): Promise<Check> {
	try {
		const proc = Bun.spawn(["bw", "--version"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const version = (await new Response(proc.stdout).text()).trim();
		const code = await proc.exited;
		if (code === 0 && version) {
			return { name: "bw version", ok: true, detail: version };
		}
	} catch {}
	return { name: "bw version", ok: false, fix: "brew upgrade bitwarden-cli" };
}

async function checkEmail(): Promise<Check> {
	const config = await loadConfig();
	if (config.email) {
		return { name: "Account email", ok: true, detail: config.email };
	}
	return {
		name: "Account email",
		ok: false,
		fix: "bwx config email your@email.com",
	};
}

async function checkMasterPassword(): Promise<Check> {
	try {
		const proc = Bun.spawn(
			[
				"security",
				"find-generic-password",
				"-a",
				"bitwarden",
				"-s",
				"bitwarden-master",
				"-w",
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		const pw = (await new Response(proc.stdout).text()).trim();
		const code = await proc.exited;
		if (code === 0 && pw) {
			return { name: "Master password", ok: true, detail: "in Keychain" };
		}
	} catch {}
	return {
		name: "Master password",
		ok: false,
		fix: "bwx config master-password",
	};
}

async function checkConfigDir(): Promise<Check> {
	const configDir =
		process.env.XDG_CONFIG_HOME ?? `${process.env.HOME}/.config`;
	const dir = `${configDir}/bwx`;
	try {
		const { accessSync, constants } = await import("node:fs");
		accessSync(dir, constants.W_OK);
		return { name: "Config directory", ok: true, detail: dir };
	} catch {}
	return {
		name: "Config directory",
		ok: false,
		detail: dir,
		fix: `mkdir -p ${dir}`,
	};
}
