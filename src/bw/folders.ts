import pc from "picocolors";
import { CliError, ExitCode } from "../cli/errors.ts";
import type { GlobalOptions } from "../cli/types.ts";
import { runBwOrThrow } from "./runner.ts";
import { withSession } from "./session.ts";

export interface BwFolder {
	/** `null` is bw's "No Folder" bucket, which every unfiled item belongs to. */
	id: string | null;
	name: string;
}

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The spelling bw expects on `--folderid` for items that are in no folder. */
export const NO_FOLDER = "null";

export async function listFolders(opts: GlobalOptions): Promise<BwFolder[]> {
	const json = await withSession(opts, () => runBwOrThrow(["list", "folders"]));
	const raw = JSON.parse(json) as Array<Record<string, unknown>>;
	return raw.map((folder) => ({
		id: typeof folder.id === "string" ? folder.id : null,
		name: String(folder.name ?? ""),
	}));
}

/**
 * Turns whatever the caller wrote in `--folder` into an id. IDs pass straight
 * through, so this costs nothing for callers that already have one; names are
 * resolved against the vault because a folder id is not something a human — or
 * an agent reading `bwx list` output — can otherwise discover.
 *
 * Returns `null` for the "no folder" bucket (`--folder none`).
 */
export async function resolveFolderRef(
	ref: string,
	opts: GlobalOptions,
): Promise<string | null> {
	if (UUID_RE.test(ref)) return ref;
	if (ref === NO_FOLDER || ref.toLowerCase() === "none") return null;

	const folders = await listFolders(opts);
	const named = folders.filter((folder) => folder.id !== null);

	const exact = named.filter(
		(folder) => folder.name.toLowerCase() === ref.toLowerCase(),
	);
	const matches =
		exact.length > 0
			? exact
			: named.filter((folder) =>
					folder.name.toLowerCase().includes(ref.toLowerCase()),
				);

	if (matches.length === 0) {
		throw new CliError(
			`No folder matching "${ref}". Run 'bwx folders' to list them.`,
			ExitCode.NotFound,
		);
	}

	if (matches.length > 1) {
		throw new CliError(
			formatAmbiguousFolders(ref, matches, opts),
			ExitCode.BadArgs,
		);
	}

	return matches[0]!.id;
}

/** Resolves `--folder` for read commands, where "no folder" is a real filter. */
export async function resolveFolderFilter(
	ref: string,
	opts: GlobalOptions,
): Promise<string> {
	return (await resolveFolderRef(ref, opts)) ?? NO_FOLDER;
}

function formatAmbiguousFolders(
	ref: string,
	matches: BwFolder[],
	opts: GlobalOptions,
): string {
	if (opts.json) {
		return `Multiple folders match "${ref}": ${JSON.stringify(matches)}`;
	}

	const lines = [`Multiple folders match "${ref}":\n`];
	for (const folder of matches) {
		lines.push(`  ${pc.dim(folder.id ?? "-")}  ${folder.name}`);
	}
	lines.push(`\nUse the full name or its ID.`);
	return lines.join("\n");
}
