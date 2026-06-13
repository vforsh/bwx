import { afterEach, describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import {
	assertSingleStdinSource,
	listExplicitStdinInputs,
	resolveFieldSources,
	resolveItemTextInputs,
	resolveOptionalTextSource,
	StdinReader,
} from "../src/cli/input.ts";
import { CliError, ExitCode } from "../src/cli/errors.ts";

const ENV_NAMES = ["BWX_TEST_PASSWORD", "BWX_TEST_FIELD"];

afterEach(() => {
	for (const name of ENV_NAMES) {
		delete process.env[name];
	}
});

describe("resolveOptionalTextSource", () => {
	test("resolves inline values", async () => {
		const value = await resolveOptionalTextSource(
			{
				label: "password",
				inline: "secret",
				flagNames: ["--password"],
			},
			new StdinReader(),
		);

		expect(value).toBe("secret");
	});

	test("resolves env values", async () => {
		process.env.BWX_TEST_PASSWORD = "from-env";

		const value = await resolveOptionalTextSource(
			{
				label: "password",
				env: "BWX_TEST_PASSWORD",
				flagNames: ["--password-env"],
			},
			new StdinReader(),
		);

		expect(value).toBe("from-env");
	});

	test("resolves file values and strips one final newline", async () => {
		const path = `${import.meta.dir}/tmp-secret.txt`;
		await Bun.write(path, "from-file\n");

		const value = await resolveOptionalTextSource(
			{
				label: "password",
				file: path,
				flagNames: ["--password-file"],
			},
			new StdinReader(),
		);

		expect(value).toBe("from-file");
		await unlink(path);
	});

	test("rejects multiple sources", async () => {
		expect(
			resolveOptionalTextSource(
				{
					label: "password",
					inline: "secret",
					env: "BWX_TEST_PASSWORD",
					flagNames: ["--password", "--password-env"],
				},
				new StdinReader(),
			),
		).rejects.toThrow(CliError);
	});
});

describe("resolveFieldSources", () => {
	test("combines inline, file, and env field values", async () => {
		const path = `${import.meta.dir}/tmp-field.txt`;
		await Bun.write(path, "file-value\n");
		process.env.BWX_TEST_FIELD = "env-value";

		const fields = await resolveFieldSources({
			inline: ["plain=inline"],
			file: [`!secret=${path}`],
			env: ["token=BWX_TEST_FIELD"],
			fileFlag: "--field-file",
			envFlag: "--field-env",
			stdin: new StdinReader(),
		});

		expect(fields).toEqual([
			{ name: "plain", value: "inline", type: 0 },
			{ name: "secret", value: "file-value", type: 1 },
			{ name: "token", value: "env-value", type: 0 },
		]);
		await unlink(path);
	});

	test("requires file/env field source values", async () => {
		expect(
			resolveFieldSources({
				inline: [],
				file: ["secret"],
				env: [],
				fileFlag: "--field-file",
				envFlag: "--field-env",
				stdin: new StdinReader(),
			}),
		).rejects.toThrow(CliError);
	});
});

describe("resolveItemTextInputs", () => {
	test("combines note and password sources", async () => {
		process.env.BWX_TEST_PASSWORD = "from-env";

		const result = await resolveItemTextInputs(
			{
				notes: "hello",
				passwordEnv: "BWX_TEST_PASSWORD",
			},
			new StdinReader(),
		);

		expect(result).toEqual({ notes: "hello", password: "from-env" });
	});

	test("rejects conflicting stdin sources", async () => {
		expect(
			resolveItemTextInputs(
				{
					notesFile: "-",
					passwordStdin: true,
				},
				new StdinReader(),
			),
		).rejects.toThrow(CliError);
	});
});

describe("stdin source validation", () => {
	test("lists explicit stdin sources", () => {
		expect(
			listExplicitStdinInputs({
				passwordStdin: true,
				fieldFileFlag: "--field-file",
				fieldFiles: ["secret=-"],
			}),
		).toEqual(["--password-stdin", "--field-file secret=-"]);
	});

	test("rejects multiple explicit stdin sources", () => {
		try {
			assertSingleStdinSource(["--password-stdin", "--notes-file -"]);
		} catch (err) {
			expect(err).toBeInstanceOf(CliError);
			expect((err as CliError).exitCode).toBe(ExitCode.BadArgs);
		}
	});
});
