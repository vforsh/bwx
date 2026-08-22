import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Scaffolding for driving the real CLI against a fake `bw`. Each harness gets its
 * own XDG config home and a `bw` first on PATH, so a test exercises the actual
 * binary — argument parsing, session cache, exit codes — without a vault.
 *
 * The fake `bw` script itself is not shared: what a test needs `bw` to do is the
 * interesting part of the test, and the scripts differ far more than they repeat.
 */
const REPO_ROOT = resolve(import.meta.dir, "../..");

export const CLI_PATH = join(REPO_ROOT, "bin/bwx");

export interface HarnessOptions {
	/** Source of the fake `bw` placed first on PATH. */
	fakeBw: string;
	/** Session token to seed into the config dir, for a warm-cache start. */
	session?: string;
	/**
	 * Freshness state to seed. Defaults to "just synced" so an unrelated vault
	 * freshness poll does not show up in every test's `bw` call log.
	 */
	lastSync?: Date | null;
	/** Extra environment for every CLI process this harness runs. */
	env?: Record<string, string>;
}

export interface Harness {
	configHome: string;
	/** Scratch directory the fake `bw` records its calls in. */
	stateDir: string;
	env: Record<string, string | undefined>;
}

export interface ProcessResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

const dirs: string[] = [];

/** Removes every harness directory; call from `afterEach`. */
export function cleanupHarnesses(): void {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
}

export function createHarness(options: HarnessOptions): Harness {
	const root = mkdtempSync(`${tmpdir()}/bwx-cli-`);
	dirs.push(root);

	const configHome = join(root, "config");
	const configDir = join(configHome, "bwx");
	const stateDir = join(root, "fake-bw-state");
	const binDir = join(root, "bin");
	mkdirSync(configDir, { recursive: true, mode: 0o700 });
	mkdirSync(stateDir, { mode: 0o700 });
	mkdirSync(binDir, { mode: 0o700 });

	const lastSync = options.lastSync === undefined ? new Date() : options.lastSync;
	if (lastSync) {
		writePrivate(join(configDir, "state.json"), {
			lastSync: lastSync.toISOString(),
			checkedAt: new Date().toISOString(),
		});
	}
	writePrivate(join(configDir, "config.json"), { email: "test@example.com" });
	if (options.session) {
		writePrivate(join(configDir, "session"), options.session);
	}

	writeExecutable(join(binDir, "bw"), options.fakeBw);
	writeExecutable(join(binDir, "security"), FAKE_SECURITY);

	return {
		configHome,
		stateDir,
		env: {
			...process.env,
			PATH: `${binDir}:${process.env.PATH ?? ""}`,
			XDG_CONFIG_HOME: configHome,
			FAKE_BW_STATE: stateDir,
			...options.env,
		},
	};
}

export async function runCli(
	harness: Harness,
	args: string[],
	env?: Record<string, string>,
): Promise<ProcessResult> {
	const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], {
		env: { ...harness.env, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	return { exitCode, stdout, stderr };
}

/** How many lines the fake `bw` appended to one of its logs. */
export function loggedCalls(harness: Harness, file: string): number {
	try {
		const contents = readFileSync(join(harness.stateDir, file), "utf8").trim();
		return contents ? contents.split("\n").length : 0;
	} catch {
		return 0;
	}
}

export function readSession(harness: Harness): string {
	return readFileSync(join(harness.configHome, "bwx/session"), "utf8");
}

export function writePrivate(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		typeof value === "string" ? value : JSON.stringify(value) + "\n",
		{ mode: 0o600 },
	);
	chmodSync(path, 0o600);
}

export function writeExecutable(path: string, contents: string): void {
	writeFileSync(path, contents, { mode: 0o700 });
	chmodSync(path, 0o700);
}

const FAKE_SECURITY = `#!/usr/bin/env bun
process.stdout.write("master-password\\n");
`;
