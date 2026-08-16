import { afterEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdtempSync,
	mkdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { withProcessLock } from "../src/config/process-lock.ts";
import { CliError, ExitCode } from "../src/cli/errors.ts";

const dirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(`${tmpdir()}/bwx-lock-`);
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("withProcessLock", () => {
	test("publishes owner-only lock state and removes it afterward", async () => {
		const path = `${tempDir()}/session.lock`;

		await withProcessLock(
			{ path, label: "test lock", waitMs: 1_000 },
			async () => {
				expect(statSync(path).mode & 0o777).toBe(0o700);
				expect(statSync(`${path}/owner.json`).mode & 0o777).toBe(0o600);
			},
		);

		expect(() => statSync(path)).toThrow();
	});

	test("bounds a contender's wait", async () => {
		const path = `${tempDir()}/session.lock`;
		let entered!: () => void;
		const ready = new Promise<void>((resolve) => {
			entered = resolve;
		});

		const holder = withProcessLock(
			{ path, label: "test lock", waitMs: 1_000 },
			async () => {
				entered();
				await Bun.sleep(100);
			},
		);
		await ready;

		try {
			await withProcessLock(
				{ path, label: "test lock", waitMs: 20, pollMs: 5 },
				async () => {},
			);
			throw new Error("expected lock acquisition to time out");
		} catch (err) {
			expect(err).toBeInstanceOf(CliError);
			expect((err as CliError).exitCode).toBe(ExitCode.Timeout);
			expect((err as Error).message).toContain("held by pid");
		}

		await holder;
	});

	test("rejects an unsafe stale-owner token before deriving cleanup paths", async () => {
		const root = tempDir();
		const path = `${root}/session.lock`;
		const sentinel = `${root}/must-survive`;
		mkdirSync(path, { mode: 0o700 });
		writeFileSync(
			`${path}/owner.json`,
			JSON.stringify({
				pid: 999_999_999,
				token: "../must-survive",
				acquiredAt: new Date().toISOString(),
			}),
			{ mode: 0o600 },
		);
		chmodSync(`${path}/owner.json`, 0o600);
		mkdirSync(sentinel);

		try {
			await withProcessLock(
				{ path, label: "test lock", waitMs: 100 },
				async () => {},
			);
			throw new Error("expected unsafe owner metadata to be rejected");
		} catch (err) {
			expect(err).toBeInstanceOf(CliError);
			expect((err as CliError).exitCode).toBe(ExitCode.Config);
			expect((err as Error).message).toContain("malformed");
		}

		expect(statSync(sentinel).isDirectory()).toBe(true);
	});
});
