import { describe, expect, test } from "bun:test";
import { rankSimilar } from "../src/bw/fields.ts";
import type { ItemSummary } from "../src/bw/items.ts";

const items: ItemSummary[] = [
	{ id: "1", type: "note", name: "GitHub PAT", username: "vforsh", hasTotp: false },
	{ id: "2", type: "login", name: "GitLab token", username: null, hasTotp: false },
	{ id: "3", type: "login", name: "Router admin", username: "admin", hasTotp: true },
	{ id: "4", type: "note", name: "npm publish token", username: null, hasTotp: false },
];

describe("rankSimilar", () => {
	test("finds the item behind a query with extra words", () => {
		const [first] = rankSimilar("GitHub PAT (old)", items);
		expect(first?.name).toBe("GitHub PAT");
	});

	test("matches on a prefix, which is what a truncated name looks like", () => {
		expect(rankSimilar("Rout", items).map((i) => i.name)).toContain(
			"Router admin",
		);
	});

	test("matches on username when the name is wrong", () => {
		expect(rankSimilar("vforsh", items).map((i) => i.id)).toEqual(["1"]);
	});

	test("ranks the better match first", () => {
		expect(rankSimilar("token", items).map((i) => i.name)).toEqual([
			"GitLab token",
			"npm publish token",
		]);
	});

	test("returns nothing rather than noise for an unrelated query", () => {
		expect(rankSimilar("zzzz", items)).toEqual([]);
	});

	test("short words do not match by accident inside longer ones", () => {
		// "not" lives inside "Router"/"token" — a match there is noise, not a hint.
		expect(rankSimilar("Acme-does-not-exist", items)).toEqual([]);
	});

	test("caps the suggestion list", () => {
		expect(rankSimilar("token", items, 1)).toHaveLength(1);
	});
});
