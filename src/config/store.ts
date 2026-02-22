import { ConfigSchema, type Config } from "./schema.ts";

const CONFIG_DIR =
	process.env.XDG_CONFIG_HOME ?? `${process.env.HOME}/.config`;
const CONFIG_PATH = `${CONFIG_DIR}/bwx/config.json`;

export function getConfigPath(): string {
	return CONFIG_PATH;
}

export async function loadConfig(): Promise<Config> {
	try {
		const text = await Bun.file(CONFIG_PATH).text();
		return ConfigSchema.parse(JSON.parse(text));
	} catch {
		return ConfigSchema.parse({});
	}
}

export async function saveConfig(config: Config): Promise<void> {
	const dir = CONFIG_PATH.replace(/\/[^/]+$/, "");
	const { mkdirSync } = await import("node:fs");
	mkdirSync(dir, { recursive: true });
	await Bun.write(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}
