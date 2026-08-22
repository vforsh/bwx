import { afterEach, describe, expect, test } from "bun:test";
import {
	cleanupHarnesses,
	createHarness,
	loggedCalls,
	readSession,
	runCli,
	type Harness,
	type ProcessResult,
} from "./helpers/cli-harness.ts";

type FakeBwMode =
	| "succeed"
	| "login"
	| "stagger-stale"
	| "fail-first"
	| "crash-first"
	| "barrier-reads";

afterEach(cleanupHarnesses);

describe("session establishment across CLI processes", () => {
	test("does not serialize readers that already have a valid session", async () => {
		const harness = harnessFor("barrier-reads", "fresh-session");

		const results = await runReaders(harness, 4);

		expectSuccessful(results, 4);
		expect(loggedCalls(harness, "unlock.log")).toBe(0);
	});

	test("coalesces concurrent readers with no cached session", async () => {
		const harness = harnessFor("succeed");

		const results = await runReaders(harness, 4);

		expectSuccessful(results, 4);
		expect(loggedCalls(harness, "unlock.log")).toBe(1);
		expect(readSession(harness)).toBe("fresh-session");
	});

	test("coalesces concurrent readers with a stale cached session", async () => {
		const harness = harnessFor("stagger-stale", "stale-session");

		const results = await runReaders(harness, 4);

		expectSuccessful(results, 4);
		expect(loggedCalls(harness, "unlock.log")).toBe(1);
		expect(readSession(harness)).toBe("fresh-session");
	});

	test("coalesces login and unlock for concurrent unauthenticated readers", async () => {
		const harness = harnessFor("login");

		const results = await runReaders(harness, 4);

		expectSuccessful(results, 4);
		expect(loggedCalls(harness, "login.log")).toBe(1);
		expect(loggedCalls(harness, "unlock.log")).toBe(1);
		expect(readSession(harness)).toBe("fresh-session");
	});

	test("releases the lock when the establishing process fails", async () => {
		const harness = harnessFor("fail-first");

		const results = await runReaders(harness, 4);

		expect(results.filter((result) => result.exitCode === 0)).toHaveLength(3);
		expect(results.filter((result) => result.exitCode !== 0)).toHaveLength(1);
		expect(loggedCalls(harness, "unlock.log")).toBe(2);
		expect(readSession(harness)).toBe("fresh-session");
	});

	test("recovers an abandoned lock after its owner is killed", async () => {
		const harness = harnessFor("crash-first");

		const results = await runReaders(harness, 4);

		expect(results.filter((result) => result.exitCode === 0)).toHaveLength(3);
		expect(results.filter((result) => result.exitCode !== 0)).toHaveLength(1);
		expect(loggedCalls(harness, "unlock.log")).toBe(2);
		expect(readSession(harness)).toBe("fresh-session");
	});
});

function harnessFor(mode: FakeBwMode, session?: string): Harness {
	return createHarness({
		fakeBw: FAKE_BW,
		session,
		env: { FAKE_BW_MODE: mode },
	});
}

/** Starts `count` readers at once; each blocks the others at a barrier in `bw`. */
async function runReaders(
	harness: Harness,
	count: number,
): Promise<ProcessResult[]> {
	return Promise.all(
		Array.from({ length: count }, () =>
			// A generous per-call budget: these readers contend with the rest of the
			// suite for CPU, and a spawn that loses that race must not read as a
			// vault timeout.
			runCli(
				harness,
				["--quiet", "--timeout", "10s", "get", "password", "Test"],
				{ FAKE_BW_READERS: String(count) },
			),
		),
	);
}

function expectSuccessful(results: ProcessResult[], count: number): void {
	expect(results).toHaveLength(count);
	for (const result of results) {
		expect(result).toEqual({ exitCode: 0, stdout: "secret\n", stderr: "" });
	}
}

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
  const deadline = Date.now() + 20_000;
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
  const deadline = Date.now() + 20_000;
  while (readdirSync(stateDir).filter((name) => name.startsWith(prefix + "-")).length < expected) {
    if (Date.now() >= deadline) {
      process.stderr.write("reader barrier timed out\\n");
      process.exit(97);
    }
    await Bun.sleep(5);
  }
}
`;
