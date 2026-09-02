import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CLI_PATH,
	cleanupHarnesses,
	createHarness,
	runCli,
	writeExecutable,
	type Harness,
} from "./helpers/cli-harness.ts";

afterEach(cleanupHarnesses);

/**
 * The values the fake `bw` below stores, spelled out here so a test asserts
 * against the stored bytes rather than against whatever the CLI happened to
 * print. The padding and the trailing newline are the point: they belong to the
 * value, and `--raw` is the promise that they survive.
 */
const STORED = {
	password: "  pad ded  ",
	notes: "first\n\nlast\n",
	token: "tok en ",
	blank: "",
	totpSeed: "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQ",
};

function harness(): Harness {
	return createHarness({ fakeBw: FAKE_BW, session: "fresh-session" });
}

describe("get --raw", () => {
	test("writes the value with no newline of its own", async () => {
		const h = harness();

		const result = await runCli(h, ["get", "password", "Padded", "--raw"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe(STORED.password);
		// The value goes to stdout and nowhere else — nothing describes the secret
		// back to the caller on the way past.
		expect(result.stderr).toBe("");
	});

	test("leaves output without the flag exactly as it was", async () => {
		const h = harness();

		const result = await runCli(h, ["get", "password", "Plain"]);

		expect(result.stdout).toBe("secret\n");
	});

	test("keeps newlines the stored value owns", async () => {
		const h = harness();

		const result = await runCli(h, ["get", "notes", "Padded", "--raw"]);

		expect(result.exitCode).toBe(0);
		// Interior blank line and the value's own final newline both survive; only
		// the one `bw` prints to frame its output is dropped.
		expect(result.stdout).toBe(STORED.notes);
	});

	test("writes nothing at all for an empty value", async () => {
		const h = harness();

		const result = await runCli(h, ["field", "blank", "Padded", "--raw"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe(STORED.blank);
	});

	test("reads a custom field through both get and field", async () => {
		const h = harness();

		const viaGet = await runCli(h, ["get", "token", "Padded", "--raw"]);
		const viaField = await runCli(h, ["field", "token", "Padded", "--raw"]);

		expect(viaGet.stdout).toBe(STORED.token);
		expect(viaField.stdout).toBe(STORED.token);
	});

	test("emits a TOTP seed without a newline", async () => {
		const h = harness();

		const result = await runCli(h, ["get", "totp", "Padded", "--seed", "--raw"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe(STORED.totpSeed);
	});

	test("refuses to combine with --json", async () => {
		const h = harness();

		const result = await runCli(h, ["--json", "get", "password", "Plain", "--raw"]);

		expect(result.exitCode).toBe(2);
		// Under --json the error is the envelope on stdout, not stderr.
		expect(result.stdout).toContain("--raw and --json cannot be combined");
		expect(result.stdout).not.toContain("secret");
	});
});

describe("get --raw through a pipe", () => {
	/**
	 * The reason `--raw` exists: a consumer reading stdin literally (`argus fill
	 * --value-stdin` and friends) receives whatever bytes arrive, so the added
	 * newline becomes the last character of the secret. Asserting on the CLI's
	 * own stdout would not catch a newline reintroduced by the shell, so this
	 * runs a real pipeline and compares what landed on the far end.
	 */
	async function pipeInto(h: Harness, args: string[]): Promise<string> {
		const consumer = join(h.stateDir, "consumer.ts");
		const capture = join(h.stateDir, "captured");
		writeExecutable(consumer, CONSUMER);

		const proc = Bun.spawn(
			["sh", "-c", '"$BUN" "$CLI" "$@" | "$BUN" "$CONSUMER"', "sh", ...args],
			{
				env: {
					...h.env,
					BUN: process.execPath,
					CLI: CLI_PATH,
					CONSUMER: consumer,
					CAPTURE: capture,
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		expect(await proc.exited).toBe(0);

		return readFileSync(capture, "utf8");
	}

	test("delivers a padded password byte-for-byte", async () => {
		expect(await pipeInto(harness(), ["get", "password", "Padded", "--raw"])).toBe(
			STORED.password,
		);
	});

	test("delivers a multiline note byte-for-byte", async () => {
		expect(await pipeInto(harness(), ["get", "notes", "Padded", "--raw"])).toBe(
			STORED.notes,
		);
	});

	test("without --raw the consumer sees the added newline", async () => {
		// The bug this flag fixes, pinned so it cannot come back by default.
		expect(await pipeInto(harness(), ["get", "password", "Plain"])).toBe("secret\n");
	});
});

/** Writes stdin to `$CAPTURE` untouched, standing in for a literal consumer. */
const CONSUMER = `#!/usr/bin/env bun
import { writeFileSync } from "node:fs";

const chunks = [];
for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
writeFileSync(process.env.CAPTURE, Buffer.concat(chunks));
`;

/**
 * Values are written the way `bw` writes them: the stored value followed by one
 * newline. Keys `bw` omits are omitted here too.
 */
const FAKE_BW = `#!/usr/bin/env bun
const command = process.argv[2];
const target = process.argv[3];
const name = process.argv[4];

const PASSWORDS = { Plain: "secret", Padded: "  pad ded  " };
const NOTES = { Padded: "first\\n\\nlast\\n" };
const FIELDS = {
  Padded: [
    { name: "token", value: "tok en ", type: 1 },
    { name: "blank", value: "", type: 0 },
  ],
};

if (command === "status") {
  process.stdout.write(JSON.stringify({
    status: process.env.BW_SESSION === "fresh-session" ? "unlocked" : "locked",
    serverUrl: null,
    lastSync: new Date().toISOString(),
    userEmail: "test@example.com",
  }) + "\\n");
  process.exit(0);
}

if (command === "unlock") {
  process.stdout.write("fresh-session\\n");
  process.exit(0);
}

if (command === "sync") process.exit(0);

if (command === "get") {
  if (PASSWORDS[name] === undefined) {
    process.stderr.write("Not found.\\n");
    process.exit(1);
  }

  if (target === "item") {
    const login = {
      username: "user@example.com",
      password: PASSWORDS[name],
      passwordRevisionDate: null,
      uris: [],
      fido2Credentials: [],
      totp: "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQ",
    };
    const item = {
      object: "item",
      id: "11111111-2222-3333-4444-555555555555",
      type: 1,
      name,
      favorite: false,
      reprompt: 0,
      fields: FIELDS[name] ?? [],
      login,
    };
    if (NOTES[name] !== undefined) item.notes = NOTES[name];
    process.stdout.write(JSON.stringify(item) + "\\n");
    process.exit(0);
  }

  if (target === "password") {
    process.stdout.write(PASSWORDS[name] + "\\n");
    process.exit(0);
  }

  if (target === "notes" && NOTES[name] !== undefined) {
    process.stdout.write(NOTES[name] + "\\n");
    process.exit(0);
  }

  process.stderr.write("Not found.\\n");
  process.exit(1);
}

process.stderr.write("unexpected fake bw call: " + String(command) + "\\n");
process.exit(98);
`;
