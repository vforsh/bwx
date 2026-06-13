import type { Command } from "commander";
import pc from "picocolors";
import { listAttachments, resolveAttachment } from "../../bw/attachments.ts";
import { runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";
import { emitData, emitSuccess } from "../io.ts";
import { getGlobalOpts } from "../program.ts";

export function registerAttach(program: Command): void {
	const attach = program
		.command("attach")
		.aliases(["attachment", "attachments"])
		.description("List and download item attachments");

	attach
		.command("list")
		.alias("ls")
		.description("List attachments for an item")
		.argument("<item>", "Item name or ID")
		.action(async function (this: Command, item: string) {
			const opts = getGlobalOpts(this);
			const current = await getItem(item, opts);
			const attachments = listAttachments(current);

			if (opts.json) {
				emitData(attachments, opts);
				return;
			}

			if (opts.plain) {
				for (const attachment of attachments) {
					process.stdout.write(
						[
							attachment.id,
							attachment.fileName,
							attachment.sizeName ?? attachment.size ?? "-",
						].join("\t") + "\n",
					);
				}
				return;
			}

			if (attachments.length === 0) {
				const itemName = typeof current.name === "string" ? current.name : item;
				process.stdout.write(`No attachments on "${itemName}"\n`);
				return;
			}

			for (const attachment of attachments) {
				const size = attachment.sizeName ?? attachment.size;
				const sizePart = size === undefined ? "" : pc.dim(` (${size})`);
				process.stdout.write(
					`${pc.dim(attachment.id)}  ${attachment.fileName}${sizePart}\n`,
				);
			}
		});

	attach
		.command("get")
		.description("Download an attachment from an item")
		.argument("<item>", "Item name or ID")
		.argument("<attachment>", "Attachment ID or filename")
		.option("-o, --output <path>", "Output file or directory")
		.action(async function (
			this: Command,
			item: string,
			attachmentQuery: string,
			localOpts: { output?: string },
		) {
			const opts = getGlobalOpts(this);
			const current = await getItem(item, opts);
			const attachments = listAttachments(current);
			const attachment = resolveAttachment(attachments, attachmentQuery);
			const itemId = String(current.id);
			const output = localOpts.output ?? attachment.fileName;

			await withSession(opts, () =>
				runBwOrThrow([
					"get",
					"attachment",
					attachment.id,
					"--itemid",
					itemId,
					"--output",
					output,
				]),
			);

			const result = {
				itemId,
				attachmentId: attachment.id,
				fileName: attachment.fileName,
				output,
			};

			if (opts.json) {
				emitData(result, opts);
			} else if (opts.plain) {
				emitData(output, opts);
			} else {
				emitSuccess(`Saved "${attachment.fileName}" to ${output}`, opts);
			}
		});
}

async function getItem(
	item: string,
	opts: ReturnType<typeof getGlobalOpts>,
): Promise<Record<string, unknown>> {
	const json = await withSession(opts, () => runBwOrThrow(["get", "item", item]));
	return JSON.parse(json) as Record<string, unknown>;
}
