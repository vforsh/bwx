import { describe, expect, test } from "bun:test";
import { summarizeItem } from "../src/bw/items.ts";
import { filterItems } from "../src/cli/items.ts";
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
		});
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
		expect(filterItems(items, { type: "login" })).toEqual([LOGIN]);
		expect(filterItems(items, { type: "notes" })).toEqual([NOTE]);
	});

	test("applies limit", () => {
		expect(filterItems(items, { limit: 1 })).toEqual([LOGIN]);
		expect(filterItems(items, { limit: 0 })).toEqual(items);
	});

	test("rejects unknown types", () => {
		expect(() => filterItems(items, { type: "passwords" })).toThrow(CliError);
	});
});
