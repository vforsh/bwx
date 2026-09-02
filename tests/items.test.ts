import { describe, expect, test } from "bun:test";
import { summarizeItem } from "../src/bw/items.ts";
import { BwItemSchema } from "../src/bw/types.ts";
import { DEFAULT_LIMIT, filterItems, parseLimit } from "../src/cli/items.ts";
import { CliError } from "../src/cli/errors.ts";

const LOGIN = {
	id: "id-1",
	type: 1,
	name: "Router",
	login: {
		username: "admin",
		password: "hunter2",
		totp: "otp-seed",
		uris: [{ uri: "http://my.keenetic.net", match: null }],
	},
	notes: "recovery notes",
	fields: [{ name: "API Key", value: "sk_live_abc", type: 1 }],
};

const NOTE = { id: "id-2", type: 2, name: "Deploy key", notes: "secret" };

describe("summarizeItem", () => {
	test("keeps only identifying data", () => {
		expect(summarizeItem(LOGIN)).toEqual({
			id: "id-1",
			type: "login",
			name: "Router",
			username: "admin",
			hasTotp: true,
		});
	});

	test("reports that a TOTP exists without carrying the secret", () => {
		expect(summarizeItem(NOTE).hasTotp).toBe(false);
		expect(
			summarizeItem({ ...LOGIN, login: { ...LOGIN.login, totp: "" } }).hasTotp,
		).toBe(false);
		expect(summarizeItem({ ...LOGIN, login: null }).hasTotp).toBe(false);
	});

	test("never carries secrets", () => {
		const serialized = JSON.stringify(summarizeItem(LOGIN));
		for (const secret of ["hunter2", "otp-seed", "sk_live_abc", "recovery notes"]) {
			expect(serialized).not.toContain(secret);
		}
	});

	test("normalizes missing usernames and unknown types", () => {
		expect(summarizeItem(NOTE).username).toBeNull();
		expect(summarizeItem({ id: "x", type: 9, name: "n" }).type).toBe("type:9");
	});
});

describe("filterItems", () => {
	const items = [LOGIN, NOTE];

	test("filters by singular and plural type names", () => {
		expect(filterItems(items, { type: "login" }).items).toEqual([LOGIN]);
		expect(filterItems(items, { type: "notes" }).items).toEqual([NOTE]);
	});

	test("applies limit", () => {
		expect(filterItems(items, { limit: 1 }).items).toEqual([LOGIN]);
		expect(filterItems(items, { limit: 0 }).items).toEqual(items);
	});

	test("reports the pre-limit total so truncation is visible", () => {
		expect(filterItems(items, { limit: 1 })).toEqual({
			items: [LOGIN],
			total: 2,
		});
	});

	test("caps unbounded listings by default", () => {
		const many = Array.from({ length: DEFAULT_LIMIT + 10 }, (_, i) => ({
			...NOTE,
			id: `id-${i}`,
		}));
		const filtered = filterItems(many, {});
		expect(filtered.items).toHaveLength(DEFAULT_LIMIT);
		expect(filtered.total).toBe(DEFAULT_LIMIT + 10);
	});

	test("counts the type filter, not the whole vault", () => {
		expect(filterItems(items, { type: "login" }).total).toBe(1);
	});

	test("rejects unknown types", () => {
		expect(() => filterItems(items, { type: "passwords" })).toThrow(CliError);
	});
});

describe("parseLimit", () => {
	test("accepts non-negative integers", () => {
		expect(parseLimit("0")).toBe(0);
		expect(parseLimit("25")).toBe(25);
	});

	test("rejects values that would otherwise be silently ignored", () => {
		for (const raw of ["abc", "-1", "1.5", "", "10x"]) {
			expect(() => parseLimit(raw)).toThrow(CliError);
		}
	});
});

describe("BwItemSchema", () => {
	/**
	 * The shape `bw get item` actually returns for an unfiled personal card: keys
	 * it has no value for are absent, not null. Requiring them once broke reads of
	 * the fields that *were* present.
	 */
	const SPARSE_CARD = {
		object: "item",
		id: "id-3",
		type: 3,
		name: "Test Card",
		notes: null,
		favorite: false,
		card: {
			brand: "Visa",
			number: "4111111111111111",
			expMonth: "12",
			expYear: "2040",
			code: "123",
		},
	};

	test("parses an item whose unset keys are omitted rather than nulled", () => {
		const parsed = BwItemSchema.parse(SPARSE_CARD);
		expect(parsed.card?.brand).toBe("Visa");
		expect(parsed.folderId).toBeUndefined();
	});

	test("keeps unrecognized card keys, so `get item` does not lose data", () => {
		const parsed = BwItemSchema.parse({
			...SPARSE_CARD,
			card: { ...SPARSE_CARD.card, someFutureKey: "kept" },
		});
		expect(parsed.card).toMatchObject({ someFutureKey: "kept" });
	});

	test("parses a login whose absent keys bw simply left out", () => {
		const parsed = BwItemSchema.parse({
			object: "item",
			id: "id-4",
			type: 1,
			name: "account.example.com",
			// No `totp` and no `uris`: bw omits both on a login without them.
			login: { username: "user", password: "secret" },
		});
		expect(parsed.login?.username).toBe("user");
		expect(parsed.login?.totp).toBeUndefined();
	});

	test("accepts a numeric expiry, which imported items carry", () => {
		const parsed = BwItemSchema.parse({
			...SPARSE_CARD,
			card: { ...SPARSE_CARD.card, expMonth: 12, expYear: 2040 },
		});
		expect(parsed.card?.expMonth).toBe(12);
	});
});
