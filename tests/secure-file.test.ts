import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { readPrivateFile, writePrivateFile } from "../src/config/secure-file.ts";

const dirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(`${tmpdir()}/bwx-secure-`);
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("writePrivateFile", () => {
	test("creates the file owner-only, leaving no temp files behind", () => {
		const dir = tempDir();
		const path = `${dir}/session`;

		writePrivateFile(path, "token");

		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(readdirSync(dir)).toEqual(["session"]);
	});

	test("creates missing directories", () => {
		const path = `${tempDir()}/nested/dir/state.json`;
		writePrivateFile(path, "{}");
		expect(readPrivateFile(path)).toEqual({ kind: "ok", text: "{}" });
	});

	test("replaces existing content and keeps mode 600", () => {
		const path = `${tempDir()}/session`;
		writeFileSync(path, "old", { mode: 0o644 });

		writePrivateFile(path, "new");

		expect(readPrivateFile(path)).toEqual({ kind: "ok", text: "new" });
		expect(statSync(path).mode & 0o777).toBe(0o600);
	});
});

describe("readPrivateFile", () => {
	test("reports a missing file", () => {
		expect(readPrivateFile(`${tempDir()}/absent`)).toEqual({ kind: "missing" });
	});

	test("rejects group- or world-accessible files", () => {
		const path = `${tempDir()}/session`;
		writePrivateFile(path, "token");
		chmodSync(path, 0o644);

		const read = readPrivateFile(path);
		expect(read.kind).toBe("rejected");
		expect(read).toHaveProperty("reason", expect.stringContaining("mode 644"));
	});

	test("rejects symlinks", () => {
		const dir = tempDir();
		writePrivateFile(`${dir}/real`, "token");
		symlinkSync(`${dir}/real`, `${dir}/link`);

		const read = readPrivateFile(`${dir}/link`);
		expect(read.kind).toBe("rejected");
		expect(read).toHaveProperty("reason", expect.stringContaining("symlink"));
	});
});
