import { randomUUID } from "node:crypto";
import {
	chmodSync,
	lstatSync,
	mkdirSync,
	renameSync,
	rmSync,
} from "node:fs";
import { dirname } from "node:path";
import { CliError, ExitCode } from "../cli/errors.ts";
import { formatDuration } from "../cli/duration.ts";
import { readPrivateFile, writePrivateFile } from "./secure-file.ts";

const OWNER_FILE = "owner.json";
const DEFAULT_POLL_MS = 50;
const SHARED_BITS = 0o077;
const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface LockOwner {
	pid: number;
	token: string;
	acquiredAt: string;
}

interface ProcessLockOptions {
	path: string;
	label: string;
	waitMs: number;
	pollMs?: number;
}

interface Ownership {
	path: string;
	owner: LockOwner;
}

/**
 * Runs a critical section under a cross-process lock. Publishing a populated
 * directory by rename keeps contenders from observing a half-created lock;
 * live owners are waited on, while dead-owner generations are safely detached.
 */
export async function withProcessLock<T>(
	options: ProcessLockOptions,
	fn: () => Promise<T>,
): Promise<T> {
	const ownership = await acquire(options);
	let bodyFailed = false;

	try {
		return await fn();
	} catch (err) {
		bodyFailed = true;
		throw err;
	} finally {
		try {
			release(ownership, options.label);
		} catch (err) {
			// Preserve the operation's useful error if cleanup also failed.
			if (!bodyFailed) throw err;
		}
	}
}

async function acquire(options: ProcessLockOptions): Promise<Ownership> {
	const startedAt = performance.now();

	while (true) {
		const ownership = tryCreate(options.path);
		if (ownership) return ownership;

		const holder = readOwner(options.path, options.label);

		if (holder && !isProcessAlive(holder.pid)) {
			if (detachAbandonedLock(options.path, holder, options.label)) continue;
		}

		// The deadline is checked even when the lock turned out to be free, so a
		// peer that keeps taking and releasing it cannot spin us indefinitely.
		const elapsed = performance.now() - startedAt;
		if (elapsed >= options.waitMs) throw timedOut(options, holder);

		// A lock that vanished mid-inspection is free: contend for it again at once
		// rather than sleeping on a holder that is already gone.
		if (!holder) continue;

		const remaining = options.waitMs - elapsed;
		await Bun.sleep(Math.min(options.pollMs ?? DEFAULT_POLL_MS, remaining));
	}
}

function timedOut(
	options: ProcessLockOptions,
	holder: LockOwner | null,
): CliError {
	const held = holder ? ` held by pid ${holder.pid}` : "";
	return new CliError(
		`Timed out after ${formatDuration(options.waitMs)} waiting for ${options.label}${held}`,
		ExitCode.Timeout,
	);
}

function tryCreate(path: string): Ownership | null {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

	const owner: LockOwner = {
		pid: process.pid,
		token: randomUUID(),
		acquiredAt: new Date().toISOString(),
	};
	const candidate = `${path}.${owner.token}.tmp`;

	try {
		mkdirSync(candidate, { mode: 0o700 });
		chmodSync(candidate, 0o700);
		writePrivateFile(
			`${candidate}/${OWNER_FILE}`,
			JSON.stringify(owner) + "\n",
		);
		try {
			renameSync(candidate, path);
			return { path, owner };
		} catch (err) {
			if (pathExists(path)) return null;
			throw err;
		}
	} finally {
		if (pathExists(candidate)) {
			rmSync(candidate, { recursive: true, force: true });
		}
	}
}

function readOwner(path: string, label: string): LockOwner | null {
	let stat;
	try {
		stat = lstatSync(path);
	} catch (err) {
		if (errorCode(err) === "ENOENT") return null;
		throw err;
	}

	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw invalidLock(label, `${path} is not a regular directory`);
	}
	if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
		throw invalidLock(label, `${path} is owned by uid ${stat.uid}`);
	}
	if (stat.mode & SHARED_BITS) {
		const mode = (stat.mode & 0o777).toString(8).padStart(3, "0");
		throw invalidLock(label, `${path} has mode ${mode}, expected 700`);
	}

	const read = readPrivateFile(`${path}/${OWNER_FILE}`);
	if (read.kind !== "ok") {
		// A holder publishes `owner.json` before the directory is renamed into
		// place, and lets go by renaming the whole directory away. So an owner file
		// that would not read, under a directory that is no longer the one just
		// inspected, means the holder released mid-read — the caller should contend
		// again rather than report a corrupt lock. Only an unreadable owner file in
		// the *same* directory is genuinely wrong.
		if (inodeAt(path) !== stat.ino) return null;

		const reason =
			read.kind === "missing"
				? `${path}/${OWNER_FILE} is missing`
				: read.reason;
		throw invalidLock(label, reason);
	}

	try {
		const owner = JSON.parse(read.text) as Partial<LockOwner>;
		if (
			!Number.isSafeInteger(owner.pid) ||
			(owner.pid ?? 0) <= 0 ||
			typeof owner.token !== "string" ||
			!UUID_RE.test(owner.token) ||
			typeof owner.acquiredAt !== "string" ||
			!Number.isFinite(Date.parse(owner.acquiredAt))
		) {
			throw new Error("invalid owner fields");
		}
		return owner as LockOwner;
	} catch {
		throw invalidLock(label, `${path}/${OWNER_FILE} is malformed`);
	}
}

function detachAbandonedLock(
	path: string,
	expected: LockOwner,
	label: string,
): boolean {
	// The generation-specific recovery lock prevents two stale observations from
	// detaching a successor that appeared between inspection and rename.
	const recoveryPath = `${path}.reap.${expected.token}`;
	const recovery = tryCreate(recoveryPath);
	if (!recovery) {
		const recoveryOwner = readOwner(recoveryPath, `${label} recovery lock`);
		if (recoveryOwner && !isProcessAlive(recoveryOwner.pid)) {
			detachAbandonedLock(
				recoveryPath,
				recoveryOwner,
				`${label} recovery lock`,
			);
		}
		return false;
	}

	let abandoned: string | null = null;
	try {
		const current = readOwner(path, label);
		if (
			!current ||
			current.token !== expected.token ||
			isProcessAlive(current.pid)
		) {
			return false;
		}

		abandoned = `${path}.${expected.token}.abandoned`;
		try {
			renameSync(path, abandoned);
		} catch (err) {
			if (errorCode(err) === "ENOENT") return false;
			throw err;
		}

		// Cleanup names the detached generation, never a successor at the lock path.
		rmSync(abandoned, { recursive: true, force: true });
		return true;
	} finally {
		release(recovery, `${label} recovery lock`);
	}
}

function release(ownership: Ownership, label: string): void {
	const current = readOwner(ownership.path, label);
	if (!current || current.token !== ownership.owner.token) {
		throw invalidLock(label, "ownership changed before release");
	}

	const released = `${ownership.path}.${ownership.owner.token}.released`;
	renameSync(ownership.path, released);
	rmSync(released, { recursive: true, force: true });
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return errorCode(err) !== "ESRCH";
	}
}

function pathExists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch (err) {
		if (errorCode(err) === "ENOENT") return false;
		throw err;
	}
}

/**
 * Identifies what currently sits at `path`, or `null` when nothing does. Compared
 * against an earlier `stat` it answers "is this still the same directory?", which
 * distinguishes a released lock from a corrupt one.
 */
function inodeAt(path: string): number | null {
	try {
		return lstatSync(path).ino;
	} catch (err) {
		if (errorCode(err) === "ENOENT") return null;
		throw err;
	}
}

function errorCode(err: unknown): string | undefined {
	return (err as NodeJS.ErrnoException)?.code;
}

function invalidLock(label: string, reason: string): CliError {
	return new CliError(`Unsafe or corrupt ${label}: ${reason}`, ExitCode.Config);
}
