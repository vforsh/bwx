import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	cleanupHarnesses, createHarness, loggedCalls, runCli,
	CLI_PATH,
	type Harness, type ProcessResult,
} from "./helpers/cli-harness.ts";

afterEach(cleanupHarnesses);

const LOGIN_ID = "11111111-2222-3333-4444-555555555555";
const NOTE_ID = "22222222-2222-3333-4444-555555555555";
const CARD_ID = "33333333-2222-3333-4444-555555555555";
const EMPTY_ID = "44444444-2222-3333-4444-555555555555";
const IDENTITY_ID = "55555555-2222-3333-4444-555555555555";
const FALLBACK_ID = "66666666-2222-3333-4444-555555555555";
const FOLDER_ID = "aaaaaaaa-2222-3333-4444-555555555555";
const ODD_NAME = " API: Key / a=b%?#\t\n雪 ' \" ";
const SECRETS = {
	password: "SENTINEL_LOGIN_PASSWORD_49",
	username: "SENTINEL_LOGIN_USERNAME_49",
	uri: "https://invalid.test/SENTINEL_URI_CREDENTIAL_49",
	loginNotes: "SENTINEL_LOGIN_NOTES_49",
	notes: "  SENTINEL_SECURE_NOTE_TOKEN_49\n\n",
	customPassword: "SENTINEL_CUSTOM_PASSWORD_49",
	odd: "SENTINEL_CUSTOM_ODD_49",
	boolean: "false",
	duplicateA: "SENTINEL_DUPLICATE_A_49",
	duplicateB: "SENTINEL_DUPLICATE_B_49",
	blankName: "SENTINEL_BLANK_NAME_49",
	customTotp: "SENTINEL_CUSTOM_TOTP_49",
	customItem: "SENTINEL_CUSTOM_ITEM_49",
	dot: "SENTINEL_DOT_NAME_49",
	cardNumber: "4111111111111199",
	cvv: "987",
	holder: "SENTINEL_CARDHOLDER_49",
	brand: "SENTINEL_BRAND_49",
	month: "3",
	year: "2099",
	totp: "otpauth://totp/SENTINEL_TOTP_LABEL_49?secret=JBSWY3DPEHPK3PXP",
	fallbackSeed: "steam://SENTINEL_UNSUPPORTED_TOTP_49",
	fallbackCode: "918273",
	unknown: "SENTINEL_UNKNOWN_PROPERTY_49",
};

const ITEMS = [
	{
		id: LOGIN_ID, name: "Fixture Login", type: 1, folderId: FOLDER_ID,
		notes: SECRETS.loginNotes, extra: SECRETS.unknown,
		login: { username: SECRETS.username, password: SECRETS.password, totp: SECRETS.totp,
			uris: [{ uri: SECRETS.uri }], fido2Credentials: [{ secret: SECRETS.unknown }] },
		fields: [
			{ name: "password", type: 1, value: SECRETS.customPassword },
			{ name: ODD_NAME, type: 0, value: SECRETS.odd },
			{ name: "enabled", type: 2, value: SECRETS.boolean },
			{ name: "duplicate", type: 1, value: SECRETS.duplicateA },
			{ name: "duplicate", type: 1, value: SECRETS.duplicateB },
			{ name: "", type: 0, value: SECRETS.blankName },
			{ name: "empty", type: 0, value: "" },
			{ name: "null", type: 1, value: null },
			{ name: "linked", type: 3, linkedId: 100, value: null },
			{ name: "unsupported", type: 77, value: SECRETS.unknown },
			{ name: "totp", type: 1, value: SECRETS.customTotp },
			{ name: "item", type: 1, value: SECRETS.customItem },
			{ name: "..", type: 0, value: SECRETS.dot },
			{ name: "__proto__", type: 1, value: SECRETS.odd },
		],
	},
	{ id: NOTE_ID, name: "Fixture Secure Note", type: 2, notes: SECRETS.notes,
		fields: [{ name: "number", type: 0, value: SECRETS.odd }] },
	{ id: CARD_ID, name: "Fixture Card", type: 3,
		card: { number: SECRETS.cardNumber, code: SECRETS.cvv, cardholderName: SECRETS.holder,
			brand: SECRETS.brand, expMonth: SECRETS.month, expYear: SECRETS.year },
		fields: [{ name: "cvv", type: 1, value: SECRETS.customPassword }] },
	{ id: EMPTY_ID, name: "Fixture Empty", type: 1, notes: "",
		login: { username: "", password: null, totp: "", uris: [] } },
	{ id: IDENTITY_ID, name: "Fixture Identity", type: 4, notes: SECRETS.loginNotes,
		identity: { ssn: SECRETS.unknown }, fields: [{ name: "token", type: 1, value: SECRETS.odd }] },
	{ id: FALLBACK_ID, name: "Fixture Fallback", type: 1, login: { totp: SECRETS.fallbackSeed } },
];

interface FieldMetadata { kind: string; name: string; type: string; ref: string }
interface Discovery { id: string; name: string; type: string; fields: FieldMetadata[] }

function harness(): Harness {
	const result = createHarness({ fakeBw: FAKE_BW, session: "fake-session" });
	writeFileSync(join(result.stateDir, "items.json"), JSON.stringify(ITEMS));
	return result;
}

function noSecrets(result: ProcessResult): void {
	const output = result.stdout + result.stderr;
	expect(output).not.toContain("SENTINEL_");
	// Short ordinary values ("3", "false") can also occur in metadata and stack lines.
	for (const secret of Object.values(SECRETS).filter((value) => value.length > 5)) {
		expect(output).not.toContain(secret);
	}
	expect(output).not.toContain("JBSWY3DPEHPK3PXP");
	expect(output).not.toContain("SENTINEL_TOTP_LABEL_49");
}

async function discover(h: Harness, extra: string[] = []): Promise<Discovery[]> {
	const result = await runCli(h, ["search", "Fixture", "--fields", "--json", ...extra]);
	expect(result.exitCode).toBe(0);
	noSecrets(result);
	return JSON.parse(result.stdout).data;
}

function ref(items: Discovery[], id: string, kind: string, name: string): string {
	return items.find((item) => item.id === id)!.fields.find((field) =>
		field.kind === kind && field.name === name,
	)!.ref;
}

function calls(h: Harness): string[][] {
	return readFileSync(join(h.stateDir, "calls.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

/** The child asserts internally and prints a fixed marker, never a secret. */
async function consume(h: Harness, bindings: Record<string, [string, string]>, extra: string[] = []): Promise<ProcessResult> {
	writeFileSync(join(h.stateDir, "expected.json"), JSON.stringify(
		Object.fromEntries(Object.entries(bindings).map(([name, [, value]]) => [name, value])),
	));
	return runCli(h, [
		...extra, "run", ...Object.entries(bindings).flatMap(([name, [reference]]) => ["--env", `${name}=${reference}`]),
		"--", process.execPath, "-e",
		`const expected = JSON.parse(await Bun.file(process.env.FAKE_BW_STATE + "/expected.json").text());
		for (const [name, value] of Object.entries(expected)) if (process.env[name] !== value) process.exit(91);
		if (process.env.OTP && !/^\\d{6}$/.test(process.env.OTP)) process.exit(92);
		process.stdout.write("consumed\\n");`,
	]);
}

/** Exercise a real stdout-to-stdin pipe, capturing only the consumer's marker. */
async function consumeStdin(
	h: Harness,
	reference: string,
	expected: string,
	flags: string[],
): Promise<ProcessResult> {
	writeFileSync(join(h.stateDir, "expected-stdin.txt"), expected);
	const script = join(h.stateDir, "pipe.ts");
	const cliArgs = [CLI_PATH, "get", reference, ...flags, "-v"];
	const verifierCode = `
const input = await Bun.stdin.text();
const expected = await Bun.file(process.env.FAKE_BW_STATE + "/expected-stdin.txt").text();
if (input !== expected) process.exit(91);
console.log("consumed");
`;
	writeFileSync(script, `
const cli = Bun.spawn([process.execPath, ...${JSON.stringify(cliArgs)}], { stdout: "pipe", stderr: "pipe" });
const verifier = Bun.spawn([process.execPath, "-e", ${JSON.stringify(verifierCode)}], {
  stdin: cli.stdout, stdout: "pipe", stderr: "pipe",
});
const [stdout, cliError, verifierError, cliExit, verifierExit] = await Promise.all([
  new Response(verifier.stdout).text(), new Response(cli.stderr).text(),
  new Response(verifier.stderr).text(), cli.exited, verifier.exited,
]);
process.stdout.write(stdout);
process.stderr.write(cliError + verifierError);
process.exit(cliExit || verifierExit);
`);
	const proc = Bun.spawn([process.execPath, script], { env: h.env, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exitCode };
}

describe("field discovery through the real CLI", () => {
	test("JSON is an explicit allowlist, with notes/login/card/custom capabilities", async () => {
		const h = harness();
		const data = await discover(h);
		expect(data).toHaveLength(6);
		for (const item of data) {
			expect(Object.keys(item).sort()).toEqual(["fields", "id", "name", "type"]);
			for (const field of item.fields) {
				expect(Object.keys(field).sort()).toEqual(["kind", "name", "ref", "type"]);
				expect(field.ref.startsWith(`bwx://${item.id}/`)).toBe(true);
			}
		}
		expect(data.find((item) => item.id === EMPTY_ID)!.fields).toEqual([]);
		const login = data.find((item) => item.id === LOGIN_ID)!;
		expect(login.fields.filter((field) => field.kind === "builtin").map((field) => field.name)).toEqual(
			["notes", "username", "password", "uri", "totp"],
		);
		expect(login.fields.filter((field) => field.kind === "custom").map((field) => field.name)).toEqual(
			["password", ODD_NAME, "enabled", "duplicate", "duplicate", "", "empty", "null", "totp", "item", "..", "__proto__"],
		);
		expect(data.find((item) => item.id === CARD_ID)!.fields.filter((field) => field.kind === "builtin").map((field) => field.name)).toEqual(
			["number", "cvv", "cardholder", "brand", "expiry", "expMonth", "expYear"],
		);
		expect(ref(data, NOTE_ID, "builtin", "notes")).toBe(`bwx://${NOTE_ID}/builtin/notes`);
		expect(data.find((item) => item.id === IDENTITY_ID)!.fields.map((field) => field.name)).toEqual(["notes", "token"]);
		expect(calls(h)).toEqual([["list", "items", "--search", "Fixture"]]);
	});

	test("human/plain/json and find alias never print values, even in verbose mode", async () => {
		const h = harness();
		for (const format of [[], ["--plain"], ["--json"]]) {
			for (const command of ["search", "find"]) {
				const result = await runCli(h, [command, "Fixture", "--fields", "-v", ...format]);
				expect(result.exitCode).toBe(0);
				noSecrets(result);
				if (format.includes("--plain")) {
					const lines = result.stdout.trimEnd().split("\n");
					expect(lines).toHaveLength(6);
					for (const line of lines) {
						const columns = line.split("\t");
						expect(columns).toHaveLength(4);
						expect(typeof JSON.parse(columns[2]!)).toBe("string");
						expect(Array.isArray(JSON.parse(columns[3]!))).toBe(true);
					}
				}
			}
		}
		expect(loggedCalls(h, "get-item.log")).toBe(0);
	});

	test("keeps standard summaries and explicit full-items unchanged", async () => {
		const h = harness();
		for (const command of ["search", "find", "list"]) {
			const args = command === "list" ? [command] : [command, "Fixture"];
			const normal = await runCli(h, [...args, "--json"]);
			expect(normal.exitCode).toBe(0);
			const summary = JSON.parse(normal.stdout).data[0];
			expect(Object.keys(summary).sort()).toEqual(["hasTotp", "id", "name", "type", "username"]);
			expect(summary.username).toBe(SECRETS.username);
			const full = await runCli(h, [...args, "--full-items", "--json"]);
			expect(full.exitCode).toBe(0);
			expect(JSON.parse(full.stdout).data[0].login.password).toBe(SECRETS.password);
		}
	});

	test("preserves type/folder filters, truncation warnings and JSON meta", async () => {
		const h = harness();
		for (const format of [[], ["--plain"], ["--json"]]) {
			const result = await runCli(h, ["find", "Fixture", "--fields", "--type", "logins", "--limit", "1", ...format]);
			expect(result.exitCode).toBe(0);
			noSecrets(result);
			expect(result.stderr).toContain("Showing 1 of 3 items");
			if (format.includes("--json")) expect(JSON.parse(result.stdout).meta).toEqual({ total: 3, shown: 1, truncated: true });
		}
		const unlimited = await runCli(h, ["search", "Fixture", "--fields", "--json", "--limit", "0"]);
		expect(JSON.parse(unlimited.stdout).meta).toEqual({ total: 6, shown: 6, truncated: false });
		const folder = await discover(h, ["--folder", "Fixture Folder"]);
		expect(folder.map((item) => item.id)).toEqual([LOGIN_ID]);
		expect(calls(h).some((call) => call.includes("--folderid") && call.includes(FOLDER_ID))).toBe(true);
		const unfiled = await discover(h, ["--folder", "none"]);
		expect(unfiled).toHaveLength(5);
		const quiet = await runCli(h, ["search", "Fixture", "--fields", "--limit", "1", "--json", "-q"]);
		expect(quiet.stderr).toBe("");
		expect(JSON.parse(quiet.stdout).meta.truncated).toBe(true);
	});

	test("keeps the default 50-item cap", async () => {
		const h = harness();
		writeFileSync(join(h.stateDir, "items.json"), JSON.stringify(Array.from({ length: 51 }, (_, index) => ({
			id: `${index.toString(16).padStart(8, "0")}-2222-3333-4444-555555555555`,
			name: `Fixture ${index}`, type: 2, notes: SECRETS.notes,
		}))));
		const result = await runCli(h, ["search", "Fixture", "--fields", "--json"]);
		expect(result.exitCode).toBe(0);
		noSecrets(result);
		expect(JSON.parse(result.stdout).data).toHaveLength(50);
		expect(JSON.parse(result.stdout).meta).toEqual({ total: 51, shown: 50, truncated: true });
		expect(result.stderr).toContain("Showing 50 of 51");
	});

	test("rejects --full-items with --fields and malformed options before reading", async () => {
		const h = harness();
		for (const extra of [["--full-items"], ["--limit", "bad"], ["--limit", "-1"]]) {
			const result = await runCli(h, ["search", "Fixture", "--fields", ...extra, "-v"]);
			expect(result.exitCode).toBe(2);
			noSecrets(result);
		}
		expect(loggedCalls(h, "calls.jsonl")).toBe(0);
	});

	test("a missing search stays NotFound without suggestions or values", async () => {
		const h = harness();
		const result = await runCli(h, ["search", "No match", "--fields", "--json", "-v"]);
		expect(result.exitCode).toBe(4);
		noSecrets(result);
		expect(JSON.parse(result.stdout).error.exitCode).toBe(4);
	});

	test("upstream errors, malformed JSON/schema/IDs, folder/auth/sync failures cannot leak", async () => {
		const h = harness();
		for (const mode of ["stderr", "json", "schema", "id", "folders", "auth", "sync"]) {
			for (const format of [[], ["--plain"], ["--json"]]) {
				const extra = mode === "folders" ? ["--folder", "Fixture Folder"] :
					mode === "sync" ? ["--sync-if-older-than", "0"] : [];
				const result = await runCli(h, ["search", "Fixture", "--fields", "-v", ...format, ...extra], { FAKE_BW_MODE: mode });
				expect(result.exitCode).not.toBe(0);
				noSecrets(result);
				expect(result.stdout + result.stderr).toContain("Could not discover fields");
				if (!format.includes("--json")) expect(result.stdout).toBe("");
			}
		}
	});

	test("partial card expiry is not advertised as a complete expiry", async () => {
		const h = harness();
		const partial = { ...ITEMS[2]!, fields: [], card: { expMonth: 3, number: " ", code: null } };
		writeFileSync(join(h.stateDir, "items.json"), JSON.stringify([partial]));
		const data = await discover(h);
		expect(data[0]!.fields.map((field) => field.name)).toEqual(["expMonth"]);
	});
});

describe("discovered references consumed by the real CLI", () => {
	test("run batches builtins, collision/unusual/duplicate/empty custom fields and preserves notes bytes after rename", async () => {
		const h = harness();
		const data = await discover(h);
		const login = data.find((item) => item.id === LOGIN_ID)!;
		const duplicateRefs = login.fields.filter((field) => field.name === "duplicate").map((field) => field.ref);
		expect(new Set(duplicateRefs).size).toBe(2);
		writeFileSync(join(h.stateDir, "items.json"), JSON.stringify(ITEMS.map((item) => ({ ...item, name: "Renamed item" }))));
		const result = await consume(h, {
			PASS: [ref(data, LOGIN_ID, "builtin", "password"), SECRETS.password],
			USER: [ref(data, LOGIN_ID, "builtin", "username"), SECRETS.username],
			URI: [ref(data, LOGIN_ID, "builtin", "uri"), SECRETS.uri],
			CUSTOM_PASS: [ref(data, LOGIN_ID, "custom", "password"), SECRETS.customPassword],
			ODD: [ref(data, LOGIN_ID, "custom", ODD_NAME), SECRETS.odd],
			BOOL: [ref(data, LOGIN_ID, "custom", "enabled"), SECRETS.boolean],
			DUP_A: [duplicateRefs[0]!, SECRETS.duplicateA],
			DUP_B: [duplicateRefs[1]!, SECRETS.duplicateB],
			BLANK: [ref(data, LOGIN_ID, "custom", ""), SECRETS.blankName],
			EMPTY: [ref(data, LOGIN_ID, "custom", "empty"), ""],
			NULL_VALUE: [ref(data, LOGIN_ID, "custom", "null"), ""],
			CUSTOM_TOTP: [ref(data, LOGIN_ID, "custom", "totp"), SECRETS.customTotp],
			CUSTOM_ITEM: [ref(data, LOGIN_ID, "custom", "item"), SECRETS.customItem],
			DOT: [ref(data, LOGIN_ID, "custom", ".."), SECRETS.dot],
			PROTOTYPE_NAME: [ref(data, LOGIN_ID, "custom", "__proto__"), SECRETS.odd],
			LEGACY: [`password:${LOGIN_ID}`, SECRETS.password],
			NOTES: [ref(data, NOTE_ID, "builtin", "notes"), SECRETS.notes],
		}, ["-v"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("consumed\n");
		expect(result.stderr).toContain("Injecting PASS, USER");
		noSecrets(result);
		expect(loggedCalls(h, "get-item.log")).toBe(2);
		expect(calls(h).filter((call) => call[0] === "get").every((call) => [LOGIN_ID, NOTE_ID].includes(call[2]!))).toBe(true);
	});

	test("card references retain normalization and custom cvv stays separate", async () => {
		const h = harness();
		const data = await discover(h);
		const result = await consume(h, {
			NUMBER: [ref(data, CARD_ID, "builtin", "number"), SECRETS.cardNumber],
			CVV: [ref(data, CARD_ID, "builtin", "cvv"), SECRETS.cvv],
			HOLDER: [ref(data, CARD_ID, "builtin", "cardholder"), SECRETS.holder],
			BRAND: [ref(data, CARD_ID, "builtin", "brand"), SECRETS.brand],
			EXPIRY: [ref(data, CARD_ID, "builtin", "expiry"), "03/2099"],
			MONTH: [ref(data, CARD_ID, "builtin", "expMonth"), "03"],
			YEAR: [ref(data, CARD_ID, "builtin", "expYear"), SECRETS.year],
			CUSTOM: [ref(data, CARD_ID, "custom", "cvv"), SECRETS.customPassword],
		}, ["-v"]);
		expect(result.exitCode).toBe(0);
		noSecrets(result);
		expect(loggedCalls(h, "get-item.log")).toBe(1);
	});

	test("TOTP reference computes locally or uses the existing bw fallback without logging codes", async () => {
		const h = harness();
		const data = await discover(h);
		const local = await runCli(h, ["run", "-v", "--env", `OTP=${ref(data, LOGIN_ID, "builtin", "totp")}`,
			"--", process.execPath, "-e", `if (!/^\\d{6}$/.test(process.env.OTP ?? "")) process.exit(91); console.log("consumed");`]);
		expect(local.exitCode).toBe(0);
		noSecrets(local);
		expect(loggedCalls(h, "get-totp.log")).toBe(0);
		const fallback = await consume(h, { OTP: [ref(data, FALLBACK_ID, "builtin", "totp"), SECRETS.fallbackCode] });
		expect(fallback.exitCode).toBe(0);
		noSecrets(fallback);
		expect(loggedCalls(h, "get-totp.log")).toBe(1);
	});

	test("get ref --raw pipelines notes/custom bytes to a consumer; custom item is not parsed as JSON", async () => {
		const h = harness();
		const data = await discover(h);
		const cases: Array<[reference: string, expected: string, flags: string[]]> = [
			[ref(data, NOTE_ID, "builtin", "notes"), SECRETS.notes, ["--raw"]],
			[ref(data, NOTE_ID, "builtin", "notes"), SECRETS.notes.trim() + "\n", []],
			[ref(data, LOGIN_ID, "custom", "item"), SECRETS.customItem, ["--raw"]],
			[ref(data, LOGIN_ID, "custom", "item"), SECRETS.customItem + "\n", []],
			[ref(data, LOGIN_ID, "custom", "totp"), SECRETS.customTotp, ["--raw"]],
			[ref(data, LOGIN_ID, "builtin", "totp"), SECRETS.totp, ["--raw", "--seed"]],
		];
		for (const [reference, expected, flags] of cases) {
			const result = await consumeStdin(h, reference, expected, flags);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("consumed\n");
			noSecrets(result);
		}
	});

	test("get TOTP ref retains freshness metadata and rejects mixed seed/fresh flags", async () => {
		const h = harness();
		const data = await discover(h);
		const reference = ref(data, LOGIN_ID, "builtin", "totp");
		const result = await runCli(h, ["get", reference, "--fresh", "0", "--json"]);
		expect(result.exitCode).toBe(0);
		const output = JSON.parse(result.stdout);
		expect(output.data).toMatch(/^\d{6}$/);
		expect(output.meta.period).toBe(30);
		expect(typeof output.meta.secondsRemaining).toBe("number");
		expect(loggedCalls(h, "get-item.log")).toBe(1);
		const invalid = await runCli(h, ["get", reference, "--fresh", "--seed", "-v"]);
		expect(invalid.exitCode).toBe(2);
		noSecrets(invalid);
		expect(loggedCalls(h, "get-item.log")).toBe(1);
	});

	test("reference errors cannot leak upstream diagnostics, schema values or candidates", async () => {
		const h = harness();
		const data = await discover(h);
		const password = ref(data, LOGIN_ID, "builtin", "password");
		for (const mode of ["stderr", "json", "schema", "wrong-id", "missing", "auth", "missing-field"]) {
			for (const format of [[], ["--plain"], ["--json"]]) {
				const result = await runCli(h, ["run", "-v", ...format, "--env", `SECRET=${password}`, "--", process.execPath, "-e", "process.exit(93)"], { FAKE_BW_MODE: mode });
				expect(result.exitCode).not.toBe(0);
				expect(result.exitCode).not.toBe(93);
				noSecrets(result);
				expect(result.stdout + result.stderr).toContain("Could not read field reference");
				const get = await runCli(h, ["get", password, "-v", ...format], { FAKE_BW_MODE: mode });
				expect(get.exitCode).not.toBe(0);
				noSecrets(get);
				expect(get.stdout + get.stderr).toContain("Could not read field reference");
			}
		}
		expect(calls(h).filter((call) => call[0] === "list")).toHaveLength(1); // discovery only; no lookup suggestions
	});

	test("stale custom positions fail before starting the child", async () => {
		const h = harness();
		const data = await discover(h);
		const shifted = JSON.parse(JSON.stringify(ITEMS));
		shifted[0].fields.shift();
		writeFileSync(join(h.stateDir, "items.json"), JSON.stringify(shifted));
		const result = await consume(h, { TOKEN: [ref(data, LOGIN_ID, "custom", ODD_NAME), SECRETS.odd] });
		expect(result.exitCode).toBe(2);
		noSecrets(result);
	});

	test("child spawn failures stay value-free and child exit status is preserved", async () => {
		const h = harness();
		const data = await discover(h);
		const reference = ref(data, LOGIN_ID, "builtin", "password");
		const missing = await runCli(h, ["run", "--env", `TOKEN=${reference}`, "-v", "--", join(h.stateDir, "missing-command")]);
		expect(missing.exitCode).toBe(2);
		noSecrets(missing);
		expect(missing.stderr).toContain("Failed to run requested command");
		const status = await runCli(h, ["run", "--env", `TOKEN=${reference}`, "--", process.execPath, "-e", "process.exit(17)"]);
		expect(status.exitCode).toBe(17);
		noSecrets(status);
	});

	test("malformed/full-item refs are rejected without reads; builtin namespace never resolves custom", async () => {
		const h = harness();
		for (const reference of [
			"bwx://name/builtin/password", `bwx://${LOGIN_ID}/builtin/item`,
			`bwx://${LOGIN_ID}/custom/-1/password`, `bwx://${LOGIN_ID}/custom/01/password`,
			`bwx://${LOGIN_ID}/custom/0/%`, `bwx://${LOGIN_ID}/custom/0/password/extra`,
			`bwx://${LOGIN_ID}/builtin/password?unexpected=${SECRETS.password}`,
		]) {
			const result = await runCli(h, ["run", "--env", `TOKEN=${reference}`, "-v", "--", "unused"]);
			expect(result.exitCode).toBe(2);
			noSecrets(result);
		}
		expect(loggedCalls(h, "calls.jsonl")).toBe(0);
		const forged = await runCli(h, ["run", "--env", `TOKEN=bwx://${NOTE_ID}/builtin/number`, "-v", "--", "unused"]);
		expect(forged.exitCode).toBe(4);
		noSecrets(forged);
	});
});

const FAKE_BW = `#!/usr/bin/env bun
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.env.FAKE_BW_STATE;
if (!dir) process.exit(99);
const args = process.argv.slice(2);
appendFileSync(join(dir, "calls.jsonl"), JSON.stringify(args) + "\\n");
const [command, target, itemId] = args;
const mode = process.env.FAKE_BW_MODE;
const secret = "SENTINEL_LOGIN_PASSWORD_49";
const die = (message, code = 1) => { process.stdout.write(secret); process.stderr.write(message + " " + secret); process.exit(code); };
if (command === "status") {
  console.log(JSON.stringify({ status: mode === "auth" ? "locked" : "unlocked", serverUrl: null, lastSync: new Date().toISOString() }));
  process.exit(0);
}
if (command === "unlock") die("unlock failure");
if (command === "sync") die("network failure");
if (mode === "auth") die("Vault is locked.");
if (target === "folders") {
  if (mode === "folders") die("folders failed");
  console.log(JSON.stringify([{ id: ${JSON.stringify(FOLDER_ID)}, name: "Fixture Folder" }]));
  process.exit(0);
}
if (mode === "stderr") die("upstream failed");
if (mode === "json") { process.stdout.write('{ broken JSON "' + secret + '"'); process.exit(0); }
let items = JSON.parse(readFileSync(join(dir, "items.json"), "utf8"));
if (mode === "schema") items[0].login.password = { secret };
if (mode === "id") items[0].id = secret;
if (command === "list" && target === "items") {
  const searchIndex = args.indexOf("--search");
  if (searchIndex >= 0) items = items.filter(item => item.name.includes(args[searchIndex + 1]));
  const folderIndex = args.indexOf("--folderid");
  if (folderIndex >= 0) items = items.filter(item => (item.folderId ?? "null") === args[folderIndex + 1]);
  process.stderr.write(secret); // Successful bw diagnostics must also stay private.
  console.log(JSON.stringify(items)); process.exit(0);
}
if (command === "get" && target === "item") {
  appendFileSync(join(dir, "get-item.log"), itemId + "\\n");
  if (mode === "missing") die("Not found.");
  const item = items.find(item => item.id === itemId);
  if (!item) die("Not found.");
  if (mode === "wrong-id") item.id = ${JSON.stringify(NOTE_ID)};
  if (mode === "missing-field") delete item.login.password;
  process.stderr.write(secret);
  console.log(JSON.stringify(item)); process.exit(0);
}
if (command === "get" && target === "totp") {
  appendFileSync(join(dir, "get-totp.log"), itemId + "\\n");
  console.log(${JSON.stringify(SECRETS.fallbackCode)}); process.exit(0);
}
die("unexpected call", 98);
`;
