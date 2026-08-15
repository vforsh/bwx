import { describe, expect, test } from "bun:test";
import { buildGenerateArgs } from "../src/bw/generate.ts";
import { redactGeneratedPassword } from "../src/cli/commands/generate.ts";
import { CliError } from "../src/cli/errors.ts";

describe("buildGenerateArgs", () => {
	test("names every wanted character set, since bw needs them explicit", () => {
		expect(buildGenerateArgs({})).toEqual([
			"generate",
			"--uppercase",
			"--lowercase",
			"--number",
		]);
	});

	test("dropping one set leaves the others named", () => {
		expect(buildGenerateArgs({ numbers: false })).toEqual([
			"generate",
			"--uppercase",
			"--lowercase",
		]);
	});

	test("adds length and special characters", () => {
		expect(buildGenerateArgs({ length: 32, special: true })).toEqual([
			"generate",
			"--length",
			"32",
			"--uppercase",
			"--lowercase",
			"--number",
			"--special",
		]);
	});

	test("rejects a request with nothing left to build from", () => {
		expect(() =>
			buildGenerateArgs({
				uppercase: false,
				lowercase: false,
				numbers: false,
				special: false,
			}),
		).toThrow(CliError);
	});

	test("rejects lengths bw would refuse", () => {
		expect(() => buildGenerateArgs({ length: 2 })).toThrow(CliError);
		expect(() => buildGenerateArgs({ length: 1.5 })).toThrow(CliError);
	});

	test("passphrases take their own flags", () => {
		expect(
			buildGenerateArgs({
				passphrase: true,
				words: 5,
				separator: "-",
				capitalize: true,
				includeNumber: true,
			}),
		).toEqual([
			"generate",
			"--passphrase",
			"--words",
			"5",
			"--separator",
			"-",
			"--capitalize",
			"--includeNumber",
		]);
	});
});

describe("redactGeneratedPassword", () => {
	const item = {
		id: "id-1",
		name: "Deploy",
		login: { username: "svc", password: "s3cr3t" },
	};

	test("keeps a generated password out of the echoed item", () => {
		const redacted = redactGeneratedPassword(item, true);
		expect(JSON.stringify(redacted)).not.toContain("s3cr3t");
		expect((redacted.login as { username: string }).username).toBe("svc");
	});

	test("leaves a caller-supplied password alone", () => {
		expect(redactGeneratedPassword(item, false)).toBe(item);
	});

	test("tolerates items with no login", () => {
		const note = { id: "id-2", name: "Note", login: null };
		expect(redactGeneratedPassword(note, true)).toBe(note);
	});
});
