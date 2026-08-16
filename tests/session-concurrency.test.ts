import { afterEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const CLI_PATH = join(REPO_ROOT, "bin/bwx");
const dirs: string[] = [];

type FakeBwMode =
	| "succeed"
	| "login"
	| "stagger-stale"
	| "fail-first"
	| "crash-first"
	| "barrier-reads";

interface Harness {
	configHome: string;
	stateDir: string;
	env: Record<string, string | undefined>;
}

interface ProcessResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("session establishment across CLI processes", () => {
	test("does not serialize readers that already have a valid session", async () => {
		const harness = createHarness("barrier-reads", "fresh-session");

		const results = await runReaders(harness, 4);

		expectSuccessful(results, 4);
		expect(unlockAttempts(harness)).toBe(0);
	});

	test("coalesces concurrent readers with no cached session", async () => {
		const harness = createHarness("succeed");

		const results = await runReaders(harness, 4);

		expectSuccessful(results, 4);
		expect(unlockAttempts(harness)).toBe(1);
		expect(readSession(harness)).toBe("fresh-session");
	});

	test("coalesces concurrent readers with a stale cached session", async () => {
		const harness = createHarness("stagger-stale", "stale-session");

		const results = await runReaders(harness, 4);

		expectSuccessful(results, 4);
		expect(unlockAttempts(harness)).toBe(1);
		expect(readSession(harness)).toBe("fresh-session");
	});

	test("coalesces login and unlock for concurrent unauthenticated readers", async () => {
		const harness = createHarness("login");

		const results = await runReaders(harness, 4);

		expectSuccessful(results, 4);
		expect(loginAttempts(harness)).toBe(1);
		expect(unlockAttempts(harness)).toBe(1);
		expect(readSession(harness)).toBe("fresh-session");
	});

	test("releases the lock when the establishing process fails", async () => {
		const harness = createHarness("fail-first");

		const results = await runReaders(harness, 4);

		expect(results.filter((result) => result.exitCode === 0)).toHaveLength(3);
		expect(results.filter((result) => result.exitCode !== 0)).toHaveLength(1);
		expect(unlockAttempts(harness)).toBe(2);
		expect(readSession(harness)).toBe("fresh-session");
	});

	test("recovers an abandoned lock after its owner is killed", async () => {
		const harness = createHarness("crash-first");

		const results = await runReaders(harness, 4);

		expect(results.filter((result) => result.exitCode === 0)).toHaveLength(3);
		expect(results.filter((result) => result.exitCode !== 0)).toHaveLength(1);
		expect(unlockAttempts(harness)).toBe(2);
		expect(readSession(harness)).toBe("fresh-session");
	});
});

function createHarness(mode: FakeBwMode, initialSession?: string): Harness {
	const root = mkdtempSync(`${tmpdir()}/bwx-session-race-`);
	dirs.push(root);

	const configHome = join(root, "config");
	const configDir = join(configHome, "bwx");
	const stateDir = join(root, "fake-bw-state");
	const binDir = join(root, "bin");
	mkdirSync(configDir, { recursive: true, mode: 0o700 });
	mkdirSync(stateDir, { mode: 0o700 });
	mkdirSync(binDir, { mode: 0o700 });

	// Avoid an unrelated freshness poll in every process; the test starts at the
	// authenticated read and session-recovery boundary it intends to exercise.
	const now = new Date().toISOString();
	writePrivate(join(configDir, "state.json"), {
		lastSync: now,
		checkedAt: now,
	});
	writePrivate(join(configDir, "config.json"), {
		email: "test@example.com",
	});
	if (initialSession) {
		writePrivate(join(configDir, "session"), initialSession);
	}

	writeExecutable(join(binDir, "bw"), FAKE_BW);
	writeExecutable(join(binDir, "security"), FAKE_SECURITY);

	return {
		configHome,
		stateDir,
		env: {
			...process.env,
			PATH: `${binDir}:${process.env.PATH ?? ""}`,
			XDG_CONFIG_HOME: configHome,
			FAKE_BW_STATE: stateDir,
			FAKE_BW_MODE: mode,
		},
	};
}

async function runReaders(
	harness: Harness,
	count: number,
): Promise<ProcessResult[]> {
	const processes = Array.from({ length: count }, () =>
		Bun.spawn(
			[
				process.execPath,
				CLI_PATH,
				"--quiet",
				"--timeout",
				"2s",
				"get",
				"password",
				"Test",
			],
			{
				env: { ...harness.env, FAKE_BW_READERS: String(count) },
				stdout: "pipe",
				stderr: "pipe",
			},
		),
	);

	return Promise.all(
		processes.map(async (proc) => {
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			return { exitCode, stdout, stderr };
		}),
	);
}

function expectSuccessful(results: ProcessResult[], count: number): void {
	expect(results).toHaveLength(count);
	for (const result of results) {
		expect(result).toEqual({ exitCode: 0, stdout: "secret\n", stderr: "" });
	}
}

function unlockAttempts(harness: Harness): number {
	return attemptCount(harness, "unlock.log");
}

function loginAttempts(harness: Harness): number {
	return attemptCount(harness, "login.log");
}

function attemptCount(harness: Harness, file: string): number {
	try {
		const contents = readFileSync(join(harness.stateDir, file), "utf8").trim();
		return contents ? contents.split("\n").length : 0;
	} catch {
		return 0;
	}
}

function readSession(harness: Harness): string {
	return readFileSync(join(harness.configHome, "bwx/session"), "utf8");
}

function writePrivate(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		typeof value === "string" ? value : JSON.stringify(value) + "\n",
		{ mode: 0o600 },
	);
	chmodSync(path, 0o600);
}

function writeExecutable(path: string, contents: string): void {
	writeFileSync(path, contents, { mode: 0o700 });
	chmodSync(path, 0o700);
}

const FAKE_SECURITY = `#!/usr/bin/env bun
process.stdout.write("master-password\\n");
`;

const FAKE_BW = `#!/usr/bin/env bun
import {
  appendFileSync,
  closeSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const stateDir = process.env.FAKE_BW_STATE;
if (!stateDir) process.exit(99);

const command = process.argv[2];
const validSession = process.env.BW_SESSION === "fresh-session";
const loginRequired = process.env.FAKE_BW_MODE === "login";
const loggedIn = !loginRequired || Bun.file(join(stateDir, "logged-in")).size > 0;

if (command === "status") {
  process.stdout.write(JSON.stringify({
    status: validSession ? "unlocked" : loggedIn ? "locked" : "unauthenticated",
    serverUrl: null,
    lastSync: new Date().toISOString(),
    userEmail: "test@example.com",
  }) + "\\n");
  process.exit(0);
}

if (command === "login") {
  appendFileSync(join(stateDir, "login.log"), String(process.pid) + "\\n");
  await Bun.sleep(200);
  writeFileSync(join(stateDir, "logged-in"), "yes", { mode: 0o600 });
  process.exit(0);
}

if (command === "get") {
  if (!validSession) {
	if (process.env.FAKE_BW_MODE === "stagger-stale") {
	  await meetReaderBarrier("stale-read");
	  if (!claim("first-stale-read")) await waitForFreshSession();
	} else {
	  await meetReaderBarrier("locked-read");
	}
    process.stderr.write("Vault is locked.\\n");
    process.exit(1);
  }
  if (process.env.FAKE_BW_MODE === "barrier-reads") {
    await meetReaderBarrier("valid-read");
  }
  process.stdout.write("secret\\n");
  process.exit(0);
}

if (command === "unlock") {
  appendFileSync(join(stateDir, "unlock.log"), String(process.pid) + "\\n");

  const first = claim("first-unlock");

  const mode = process.env.FAKE_BW_MODE;
  if (first && mode === "fail-first") {
    process.stderr.write("simulated unlock failure\\n");
    process.exit(1);
  }
  if (first && mode === "crash-first") {
    await Bun.sleep(25);
    process.kill(process.ppid, "SIGKILL");
    await Bun.sleep(25);
    process.exit(17);
  }

  await Bun.sleep(200);
  process.stdout.write("fresh-session\\n");
  process.exit(0);
}

process.stderr.write("unexpected fake bw command: " + String(command) + "\\n");
process.exit(98);

function claim(name) {
  try {
    const fd = openSync(join(stateDir, name), "wx", 0o600);
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

async function waitForFreshSession() {
  const path = join(process.env.XDG_CONFIG_HOME, "bwx/session");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      if (readFileSync(path, "utf8").trim() === "fresh-session") return;
    } catch {}
    await Bun.sleep(5);
  }
  process.stderr.write("fresh session wait timed out\\n");
  process.exit(96);
}

async function meetReaderBarrier(prefix) {
  writeFileSync(join(stateDir, prefix + "-" + String(process.ppid)), "", {
    flag: "wx",
    mode: 0o600,
  });
  const expected = Number(process.env.FAKE_BW_READERS);
  const deadline = Date.now() + 5_000;
  while (readdirSync(stateDir).filter((name) => name.startsWith(prefix + "-")).length < expected) {
    if (Date.now() >= deadline) {
      process.stderr.write("reader barrier timed out\\n");
      process.exit(97);
    }
    await Bun.sleep(5);
  }
}
`;
