import { describe, expect, test } from "bun:test";
import {
	planFreshnessCheck,
	STALE_AFTER_MS,
	type FreshnessSnapshot,
} from "../src/bw/freshness.ts";

const NOW = Date.parse("2026-08-14T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function snapshot(
	syncedAgoMs: number | null,
	checkedAgoMs: number,
): FreshnessSnapshot {
	return {
		lastSync:
			syncedAgoMs === null ? null : new Date(NOW - syncedAgoMs).toISOString(),
		checkedAt: new Date(NOW - checkedAgoMs).toISOString(),
	};
}

describe("planFreshnessCheck", () => {
	test("polls when nothing is cached", () => {
		expect(planFreshnessCheck(null, STALE_AFTER_MS, NOW)).toBe("poll");
	});

	test("skips a vault synced inside the threshold — no bw call", () => {
		expect(planFreshnessCheck(snapshot(2 * HOUR, 2 * HOUR), STALE_AFTER_MS, NOW)).toBe(
			"skip",
		);
	});

	test("trusts a recent stale reading instead of re-polling", () => {
		expect(planFreshnessCheck(snapshot(8 * 24 * HOUR, MINUTE), STALE_AFTER_MS, NOW)).toBe(
			"stale",
		);
	});

	test("re-polls once a stale reading gets old", () => {
		expect(
			planFreshnessCheck(snapshot(8 * 24 * HOUR, 30 * MINUTE), STALE_AFTER_MS, NOW),
		).toBe("poll");
	});

	test("honors a tighter threshold from --sync-if-older-than", () => {
		const recent = snapshot(30 * MINUTE, MINUTE);
		expect(planFreshnessCheck(recent, STALE_AFTER_MS, NOW)).toBe("skip");
		expect(planFreshnessCheck(recent, 15 * MINUTE, NOW)).toBe("stale");
	});

	test("treats a never-synced vault as stale", () => {
		expect(planFreshnessCheck(snapshot(null, MINUTE), STALE_AFTER_MS, NOW)).toBe(
			"stale",
		);
	});

	test("polls when timestamps are unusable or from the future", () => {
		expect(
			planFreshnessCheck(
				{ lastSync: "not-a-date", checkedAt: "also-not-a-date" },
				STALE_AFTER_MS,
				NOW,
			),
		).toBe("poll");
		expect(planFreshnessCheck(snapshot(8 * 24 * HOUR, -HOUR), STALE_AFTER_MS, NOW)).toBe(
			"poll",
		);
	});
});
