import { describe, expect, test } from "bun:test";
import { listAttachments, resolveAttachment } from "../src/bw/attachments.ts";
import { CliError, ExitCode } from "../src/cli/errors.ts";

describe("listAttachments", () => {
	test("returns normalized attachments", () => {
		const attachments = listAttachments({
			attachments: [
				{
					id: "att-1",
					fileName: "cert.p12",
					size: 1234,
					sizeName: "1.2 KB",
					url: "https://example.test",
				},
			],
		});

		expect(attachments).toEqual([
			{
				id: "att-1",
				fileName: "cert.p12",
				size: 1234,
				sizeName: "1.2 KB",
			},
		]);
	});

	test("returns empty array when item has no attachments", () => {
		expect(listAttachments({ name: "No files" })).toEqual([]);
		expect(listAttachments({ attachments: null })).toEqual([]);
	});

	test("skips malformed attachment entries", () => {
		const attachments = listAttachments({
			attachments: [
				{ id: "ok", fileName: "ok.txt" },
				{ id: "missing-name" },
				null,
			],
		});

		expect(attachments).toEqual([{ id: "ok", fileName: "ok.txt" }]);
	});
});

describe("resolveAttachment", () => {
	const attachments = [
		{ id: "att-1", fileName: "cert.p12" },
		{ id: "att-2", fileName: "profile.mobileprovision" },
	];

	test("resolves by id", () => {
		expect(resolveAttachment(attachments, "att-1")).toEqual(attachments[0]!);
	});

	test("resolves by filename", () => {
		expect(resolveAttachment(attachments, "profile.mobileprovision")).toEqual(
			attachments[1]!,
		);
	});

	test("throws not found with available filenames", () => {
		expect(() => resolveAttachment(attachments, "missing")).toThrow(CliError);

		try {
			resolveAttachment(attachments, "missing");
		} catch (err) {
			expect(err).toBeInstanceOf(CliError);
			expect((err as CliError).exitCode).toBe(ExitCode.NotFound);
			expect((err as CliError).message).toContain("cert.p12");
		}
	});

	test("throws on ambiguous filename", () => {
		expect(() =>
			resolveAttachment(
				[
					{ id: "att-1", fileName: "same.txt" },
					{ id: "att-2", fileName: "same.txt" },
				],
				"same.txt",
			),
		).toThrow(CliError);
	});
});
