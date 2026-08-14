import {
	chmodSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;
/** Group/other permission bits — none of them may be set on a private file. */
const SHARED_BITS = 0o077;

export type PrivateFileRead =
	| { kind: "ok"; text: string }
	| { kind: "missing" }
	| { kind: "rejected"; reason: string };

/**
 * Writes owner-only data atomically: a temp file in the destination directory is
 * created with mode 0600 and then renamed over the target. Unlike write-then-chmod
 * there is no window in which the payload is readable by others, and a crash leaves
 * either the old file or the new one — never a permissive partial write.
 */
export function writePrivateFile(path: string, contents: string): void {
	mkdirSync(dirname(path), { recursive: true, mode: PRIVATE_DIR_MODE });

	const tmp = `${path}.${process.pid}.tmp`;
	try {
		writeFileSync(tmp, contents, { mode: PRIVATE_FILE_MODE });
		// writeFileSync's mode is subject to umask; chmod makes it exact.
		chmodSync(tmp, PRIVATE_FILE_MODE);
		renameSync(tmp, path);
	} catch (err) {
		try {
			unlinkSync(tmp);
		} catch {
			// Nothing to clean up.
		}
		throw err;
	}
}

/**
 * Reads a file that is only trustworthy when it is a regular, owner-only file.
 * A symlink, foreign owner, or any group/other permission bit means someone else
 * could have planted or read the contents, so it is reported as rejected rather
 * than returned — callers fall back to acquiring the data again.
 */
export function readPrivateFile(path: string): PrivateFileRead {
	let stat;
	try {
		stat = lstatSync(path);
	} catch {
		return { kind: "missing" };
	}

	if (stat.isSymbolicLink()) {
		return { kind: "rejected", reason: `${path} is a symlink` };
	}
	if (!stat.isFile()) {
		return { kind: "rejected", reason: `${path} is not a regular file` };
	}
	if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
		return { kind: "rejected", reason: `${path} is owned by uid ${stat.uid}` };
	}
	if (stat.mode & SHARED_BITS) {
		const mode = (stat.mode & 0o777).toString(8).padStart(3, "0");
		return { kind: "rejected", reason: `${path} has mode ${mode}, expected 600` };
	}

	try {
		return { kind: "ok", text: readFileSync(path, "utf8") };
	} catch (err) {
		return {
			kind: "rejected",
			reason: `${path} could not be read: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}
