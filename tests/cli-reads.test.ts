import { afterEach, describe, expect, test } from "bun:test";
import {
	cleanupHarnesses,
	createHarness,
	loggedCalls,
	readSession,
	runCli,
	type Harness,
} from "./helpers/cli-harness.ts";

afterEach(cleanupHarnesses);

/** A 2-second period keeps the `--fresh` wait short enough to test directly. */
const FAST_SECRET = "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQ&period=2";

function warmHarness(totp: string | null): Harness {
	return createHarness({
		fakeBw: FAKE_BW,
		session: "fresh-session",
		env: totp ? { FAKE_BW_TOTP: totp } : undefined,
	});
}

function parseJson(stdout: string): { data: unknown; meta?: Record<string, number> } {
	return JSON.parse(stdout);
}

describe("get totp", () => {
	test("computes a code from a single vault read", async () => {
		const harness = warmHarness("GEZDGNBVGY3TQOJQ");

		const result = await runCli(harness, ["--json", "get", "totp", "Test"]);

		expect(result.exitCode).toBe(0);
		const { data, meta } = parseJson(result.stdout);
		expect(data).toMatch(/^\d{6}$/);
		expect(meta?.period).toBe(30);
		// The point of computing locally: no `bw get totp` spawn on top of the read.
		expect(loggedCalls(harness, "get-item.log")).toBe(1);
		expect(loggedCalls(harness, "get-totp.log")).toBe(0);
	});

	test("waits out a dying window without reading the vault again", async () => {
		const harness = warmHarness(FAST_SECRET);

		// Threshold above the period, so the wait always happens.
		const startedAt = performance.now();
		const result = await runCli(harness, [
			"--json",
			"get",
			"totp",
			"Test",
			"--fresh",
			"3",
		]);
		const elapsed = performance.now() - startedAt;

		expect(result.exitCode).toBe(0);
		const { data, meta } = parseJson(result.stdout);
		expect(data).toMatch(/^\d{6}$/);
		// The shortest possible wait is one second plus the settling beat, so this
		// only holds if the window was actually waited out.
		expect(elapsed).toBeGreaterThan(1_200);
		// The otpauth period was honoured, so the code came from the local
		// computation rather than the `bw` fallback (which reports the 30s default).
		expect(meta?.period).toBe(2);
		// The code after the wait was recomputed from the secret already in hand,
		// rather than costing a second read of the vault.
		expect(loggedCalls(harness, "get-item.log")).toBe(1);
	});

	test("defers to bw for a secret it will not compute itself", async () => {
		const harness = warmHarness("steam://ABCDEFGHIJKLMNOPQRSTUVWXYZ");

		const result = await runCli(harness, ["--json", "get", "totp", "Test"]);

		expect(result.exitCode).toBe(0);
		expect(parseJson(result.stdout).data).toBe("999999");
		expect(loggedCalls(harness, "get-totp.log")).toBe(1);
	});

	test("emits the stored secret with --seed", async () => {
		const harness = warmHarness(FAST_SECRET);

		const result = await runCli(harness, [
			"--json",
			"get",
			"totp",
			"Test",
			"--seed",
		]);

		expect(result.exitCode).toBe(0);
		expect(parseJson(result.stdout).data).toBe(FAST_SECRET);
		expect(loggedCalls(harness, "get-totp.log")).toBe(0);
	});

	test("reports an item with no TOTP secret as not found", async () => {
		const harness = warmHarness(null);

		const result = await runCli(harness, ["get", "totp", "Test"]);

		expect(result.exitCode).toBe(4);
		expect(result.stderr).toContain("No totp found");
	});
});

describe("stale session recovery", () => {
	test("revalidates the rejected token only once", async () => {
		const harness = createHarness({ fakeBw: FAKE_BW, session: "stale-session" });

		const result = await runCli(harness, ["get", "password", "Test"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("secret\n");
		expect(readSession(harness)).toBe("fresh-session");
		expect(loggedCalls(harness, "unlock.log")).toBe(1);
		// One `bw status` to confirm the cached token is dead, one inside the lock
		// to read vault state. The token is not interrogated a second time just
		// because the unchanged cache was re-read after taking the lock.
		expect(loggedCalls(harness, "status.log")).toBe(2);
	});
});

const FAKE_BW = `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const stateDir = process.env.FAKE_BW_STATE;
if (!stateDir) process.exit(99);

const command = process.argv[2];
const target = process.argv[3];
const valid = process.env.BW_SESSION === "fresh-session";

function log(name) {
  appendFileSync(join(stateDir, name + ".log"), String(process.pid) + "\\n");
}

if (command === "status") {
  log("status");
  process.stdout.write(JSON.stringify({
    status: valid ? "unlocked" : "locked",
    serverUrl: null,
    lastSync: new Date().toISOString(),
    userEmail: "test@example.com",
  }) + "\\n");
  process.exit(0);
}

if (command === "unlock") {
  log("unlock");
  process.stdout.write("fresh-session\\n");
  process.exit(0);
}

if (command === "sync") {
  log("sync");
  process.exit(0);
}

if (command === "get") {
  log("get-" + String(target));

  if (!valid) {
    process.stderr.write("Vault is locked.\\n");
    process.exit(1);
  }

  if (target === "item") {
    process.stdout.write(JSON.stringify({
      id: "11111111-2222-3333-4444-555555555555",
      organizationId: null,
      folderId: null,
      type: 1,
      name: "Test",
      notes: null,
      favorite: false,
      fields: null,
      login: {
        username: "user@example.com",
        password: "secret",
        totp: process.env.FAKE_BW_TOTP ?? null,
        uris: null,
      },
    }) + "\\n");
    process.exit(0);
  }

  if (target === "totp") {
    process.stdout.write("999999\\n");
    process.exit(0);
  }

  if (target === "password") {
    process.stdout.write("secret\\n");
    process.exit(0);
  }
}

process.stderr.write(
  "unexpected fake bw call: " + String(command) + " " + String(target) + "\\n",
);
process.exit(98);
`;
