import { mkdirSync } from "node:fs";
import { CONFIG_DIR, CONFIG_FILE } from "./paths.ts";
import { ConfigSchema, type Config } from "./schema.ts";

export function getConfigPath(): string {
	return CONFIG_FILE;
}

export async function loadConfig(): Promise<Config> {
	try {
		const text = await Bun.file(CONFIG_FILE).text();
		return ConfigSchema.parse(JSON.parse(text));
	} catch {
		return ConfigSchema.parse({});
	}
}

export async function saveConfig(config: Config): Promise<void> {
	mkdirSync(CONFIG_DIR, { recursive: true });
	await Bun.write(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}
