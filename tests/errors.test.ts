import { describe, expect, test } from "bun:test";
import { classifyBwError, CliError, ExitCode } from "../src/cli/errors.ts";

describe("classifyBwError", () => {
	test("not logged in → AuthFailed", () => {
		expect(classifyBwError("You are not logged in.")).toBe(ExitCode.AuthFailed);
	});

	test("unauthenticated → AuthFailed", () => {
		expect(classifyBwError("unauthenticated")).toBe(ExitCode.AuthFailed);
	});

	test("vault is locked → AuthFailed", () => {
		expect(classifyBwError("Vault is locked.")).toBe(ExitCode.AuthFailed);
	});

	test("not found → NotFound", () => {
		expect(classifyBwError("Not found.")).toBe(ExitCode.NotFound);
	});

	test("more than one result → BadArgs", () => {
		expect(classifyBwError("More than one result was found.")).toBe(
			ExitCode.BadArgs,
		);
	});

	test("timeout → Timeout", () => {
		expect(classifyBwError("Request timed out")).toBe(ExitCode.Timeout);
	});

	test("ECONNREFUSED → Network", () => {
		expect(classifyBwError("connect ECONNREFUSED 127.0.0.1:443")).toBe(
			ExitCode.Network,
		);
	});

	test("unknown error → BwError", () => {
		expect(classifyBwError("Something weird happened")).toBe(ExitCode.BwError);
	});
});

describe("CliError", () => {
	test("has message and exitCode", () => {
		const err = new CliError("boom", ExitCode.Config);
		expect(err.message).toBe("boom");
		expect(err.exitCode).toBe(ExitCode.Config);
		expect(err.name).toBe("CliError");
	});

	test("defaults to Unknown exitCode", () => {
		const err = new CliError("oops");
		expect(err.exitCode).toBe(ExitCode.Unknown);
	});
});
