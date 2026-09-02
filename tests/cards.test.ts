import { afterEach, describe, expect, test } from "bun:test";
import { CARD_FIELDS, isCardField, readCardValue } from "../src/bw/cards.ts";
import {
	cleanupHarnesses,
	createHarness,
	loggedCalls,
	runCli,
	type Harness,
} from "./helpers/cli-harness.ts";

afterEach(cleanupHarnesses);

const CARD = {
	cardholderName: "Vladislav Forsh",
	brand: "Visa",
	number: "4111111111111111",
	// Unpadded, which is how bw stores a single-digit month.
	expMonth: "3",
	expYear: "2030",
	code: "123",
};

describe("readCardValue", () => {
	test("resolves every canonical field", () => {
		expect(
			CARD_FIELDS.map((field) => [field, readCardValue(CARD, field)]),
		).toEqual([
			["number", "4111111111111111"],
			["cvv", "123"],
			["cardholder", "Vladislav Forsh"],
			["brand", "Visa"],
			["expiry", "03/2030"],
			["expMonth", "03"],
			["expYear", "2030"],
		]);
	});

	test("accepts bw's own JSON keys, so a name copied from `get item` works", () => {
		expect(readCardValue(CARD, "code")).toBe("123");
		expect(readCardValue(CARD, "cardholderName")).toBe("Vladislav Forsh");
		expect(readCardValue(CARD, "expMonth")).toBe("03");
	});

	test("matches leniently on case, dashes, and underscores", () => {
		for (const spelling of ["expMonth", "expmonth", "exp-month", "EXP_MONTH"]) {
			expect(readCardValue(CARD, spelling)).toBe("03");
		}
	});

	test("pads a single-digit month everywhere it appears", () => {
		expect(readCardValue({ ...CARD, expMonth: 3 }, "expMonth")).toBe("03");
		expect(readCardValue({ ...CARD, expMonth: "11" }, "expiry")).toBe("11/2030");
	});

	test("withholds a half expiry rather than passing it off as a date", () => {
		expect(readCardValue({ ...CARD, expYear: null }, "expiry")).toBeNull();
		expect(readCardValue({ ...CARD, expMonth: "" }, "expiry")).toBeNull();
	});

	test("treats an empty stored value as absent", () => {
		expect(readCardValue({ ...CARD, code: "" }, "cvv")).toBeNull();
		expect(readCardValue({}, "number")).toBeNull();
	});

	test("does not claim login or custom field names", () => {
		for (const field of ["password", "username", "totp", "notes", "uri", "item"]) {
			expect(isCardField(field)).toBe(false);
		}
	});
});

describe("get <card field>", () => {
	function harness(): Harness {
		return createHarness({ fakeBw: FAKE_BW, session: "fresh-session" });
	}

	test("reads a card field from a single vault read", async () => {
		const result = await runCli(harness(), ["--plain", "get", "cvv", "Visa"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("123");
	});

	test("composes the expiry the card does not store", async () => {
		const result = await runCli(harness(), ["--plain", "get", "expiry", "Visa"]);

		expect(result.stdout.trim()).toBe("03/2030");
	});

	test("costs no `bw get <field>` spawn, since bw has no card fields", async () => {
		const h = harness();
		await runCli(h, ["--plain", "get", "number", "Visa"]);

		expect(loggedCalls(h, "get-item.log")).toBe(1);
		expect(loggedCalls(h, "get-number.log")).toBe(0);
	});

	test("batches card fields with the rest of the item in `run`", async () => {
		const h = harness();
		const result = await runCli(h, [
			"run",
			"--env",
			"NUM=number:Visa",
			"--env",
			"CVV=cvv:Visa",
			"--",
			"sh",
			"-c",
			'printf "%s %s" "$NUM" "$CVV"',
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("4111111111111111 123");
		expect(loggedCalls(h, "get-item.log")).toBe(1);
	});

	test("reports an unset field against the item by name", async () => {
		const result = await runCli(harness(), ["get", "cardholder", "Blank"]);

		expect(result.exitCode).toBe(4);
		expect(result.stderr).toContain("No cardholder found for item: Blank");
	});

	test("still finds a custom field of the same name on a login item", async () => {
		const result = await runCli(harness(), ["--plain", "get", "number", "Login"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("custom-number");
	});

	test("says the item is not a card when the custom field is missing too", async () => {
		const result = await runCli(harness(), ["get", "cvv", "Login"]);

		expect(result.exitCode).toBe(4);
		expect(result.stderr).toContain('"Login" is a login item');
		expect(result.stderr).toContain("Card fields:");
	});

	test("`field` keeps reading custom fields only", async () => {
		const result = await runCli(harness(), ["field", "number", "Visa"]);

		expect(result.exitCode).toBe(4);
		expect(result.stderr).toContain("item has no custom fields");
	});
});

const FAKE_BW = `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const stateDir = process.env.FAKE_BW_STATE;
if (!stateDir) process.exit(99);

const command = process.argv[2];
const target = process.argv[3];
const name = process.argv[4];

function log(file) {
  appendFileSync(join(stateDir, file + ".log"), String(process.pid) + "\\n");
}

if (command === "status") {
  log("status");
  process.stdout.write(JSON.stringify({
    status: "unlocked",
    serverUrl: null,
    lastSync: new Date().toISOString(),
    userEmail: "test@example.com",
  }) + "\\n");
  process.exit(0);
}

const CARD = {
  cardholderName: "Vladislav Forsh",
  brand: "Visa",
  number: "4111111111111111",
  expMonth: "3",
  expYear: "2030",
  code: "123",
};

const ITEMS = {
  Visa: { type: 3, name: "Visa", card: CARD },
  Blank: { type: 3, name: "Blank", card: { ...CARD, cardholderName: null } },
  Login: {
    type: 1,
    name: "Login",
    login: { username: "user", password: "secret", totp: null, uris: null },
    fields: [{ name: "number", value: "custom-number", type: 1 }],
  },
};

if (command === "get" && target === "item") {
  log("get-item");
  const item = ITEMS[name];
  if (!item) {
    process.stderr.write("Not found.\\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({
    id: "11111111-2222-3333-4444-555555555555",
    organizationId: null,
    folderId: null,
    notes: null,
    favorite: false,
    fields: null,
    ...item,
  }) + "\\n");
  process.exit(0);
}

if (command === "get") {
  log("get-" + String(target));
  process.stderr.write("Not found.\\n");
  process.exit(1);
}

process.stderr.write("unexpected fake bw call: " + String(command) + "\\n");
process.exit(98);
`;
