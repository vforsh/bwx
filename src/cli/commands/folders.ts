import type { Command } from "commander";
import pc from "picocolors";
import { listFolders } from "../../bw/folders.ts";
import { emitData } from "../io.ts";
import { getGlobalOpts } from "../program.ts";

/**
 * Folder IDs are the only handle `--folder` used to accept, and nothing else in
 * bwx ever printed one — so this is what makes that flag usable at all.
 */
export function registerFolders(program: Command): void {
	program
		.command("folders")
		.alias("folder")
		.description("List vault folders")
		.action(async function (this: Command) {
			const opts = getGlobalOpts(this);
			const folders = await listFolders(opts);

			if (opts.json) {
				emitData(folders, opts);
				return;
			}

			for (const folder of folders) {
				const id = folder.id ?? "-";
				process.stdout.write(
					opts.plain
						? `${id}\t${folder.name}\n`
						: `${pc.dim(id)}  ${folder.name}\n`,
				);
			}
		});
}
