import { describe, expect, test } from "bun:test";
import { parseEnvSpec, parseEnvSpecs } from "../src/cli/commands/run.ts";
import { CliError, ExitCode } from "../src/cli/errors.ts";

describe("parseEnvSpec", () => {
	test("splits name, field, and item", () => {
		expect(parseEnvSpec("DB_PASS=password:Prod DB")).toEqual({
			name: "DB_PASS",
			field: "password",
			item: "Prod DB",
		});
	});

	test("keeps colons in the item name", () => {
		expect(parseEnvSpec("KEENETIC_PASS=password:http://my.keenetic.net")).toEqual({
			name: "KEENETIC_PASS",
			field: "password",
			item: "http://my.keenetic.net",
		});
	});

	test("supports custom field names", () => {
		expect(parseEnvSpec("TOKEN=API Key:Acme")).toEqual({
			name: "TOKEN",
			field: "API Key",
			item: "Acme",
		});
	});

	test("rejects malformed specs", () => {
		for (const raw of [
			"DB_PASS",
			"=password:item",
			"DB_PASS=password",
			"DB_PASS=:item",
			"DB_PASS=password:",
			"2FA=totp:item",
			"DB-PASS=password:item",
		]) {
			expect(() => parseEnvSpec(raw)).toThrow(CliError);
		}
	});

	test("reports bad specs as an argument error", () => {
		try {
			parseEnvSpec("nope");
			throw new Error("expected a CliError");
		} catch (err) {
			expect(err).toBeInstanceOf(CliError);
			expect((err as CliError).exitCode).toBe(ExitCode.BadArgs);
		}
	});
});

describe("parseEnvSpecs", () => {
	test("parses every flag", () => {
		expect(parseEnvSpecs(["A=password:One", "B=username:Two"])).toHaveLength(2);
	});

	test("requires at least one spec", () => {
		expect(() => parseEnvSpecs([])).toThrow(CliError);
	});

	test("rejects duplicate names before any vault access", () => {
		expect(() => parseEnvSpecs(["A=password:One", "A=password:Two"])).toThrow(
			/Duplicate --env name "A"/,
		);
	});
});
