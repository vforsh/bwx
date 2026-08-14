import { describe, expect, test } from "bun:test";
import { formatDuration, parseDuration } from "../src/cli/duration.ts";
import { CliError } from "../src/cli/errors.ts";

describe("parseDuration", () => {
	test("parses unit suffixes", () => {
		expect(parseDuration("250ms", "--timeout")).toBe(250);
		expect(parseDuration("30s", "--timeout")).toBe(30_000);
		expect(parseDuration("15m", "--timeout")).toBe(900_000);
		expect(parseDuration("2h", "--timeout")).toBe(7_200_000);
		expect(parseDuration("1d", "--timeout")).toBe(86_400_000);
	});

	test("treats a bare number as seconds", () => {
		expect(parseDuration("45", "--timeout")).toBe(45_000);
		expect(parseDuration("0", "--timeout")).toBe(0);
	});

	test("accepts fractions and surrounding space", () => {
		expect(parseDuration(" 1.5m ", "--timeout")).toBe(90_000);
	});

	test("rejects unparseable values", () => {
		for (const raw of ["", "soon", "-5s", "5 s", "5w"]) {
			expect(() => parseDuration(raw, "--timeout")).toThrow(CliError);
		}
	});
});

describe("formatDuration", () => {
	test("picks a coarse unit", () => {
		expect(formatDuration(45_000)).toBe("45s");
		expect(formatDuration(12 * 60_000)).toBe("12m");
		expect(formatDuration(3 * 3_600_000)).toBe("3h");
		expect(formatDuration(8 * 86_400_000)).toBe("8d");
	});
});
