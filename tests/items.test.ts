import { describe, expect, test } from "bun:test";
import { summarizeItem } from "../src/bw/items.ts";
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
