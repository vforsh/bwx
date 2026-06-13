import { CliError, ExitCode } from "../cli/errors.ts";

export interface AttachmentInfo {
	id: string;
	fileName: string;
	size?: number;
	sizeName?: string;
}

export function listAttachments(item: Record<string, unknown>): AttachmentInfo[] {
	const raw = item.attachments;
	if (!Array.isArray(raw)) return [];

	return raw
		.map((attachment) => normalizeAttachment(attachment))
		.filter((attachment): attachment is AttachmentInfo => attachment !== null);
}

export function resolveAttachment(
	attachments: AttachmentInfo[],
	query: string,
): AttachmentInfo {
	const matches = attachments.filter(
		(attachment) => attachment.id === query || attachment.fileName === query,
	);

	if (matches.length === 1) return matches[0]!;

	if (matches.length > 1) {
		throw new CliError(
			`Multiple attachments match "${query}". Use an attachment ID instead.`,
			ExitCode.BadArgs,
		);
	}

	const available = attachments.map((attachment) => attachment.fileName).join(", ");
	const suffix = available ? ` Available: ${available}` : "";
	throw new CliError(`Attachment "${query}" not found.${suffix}`, ExitCode.NotFound);
}

function normalizeAttachment(value: unknown): AttachmentInfo | null {
	if (!value || typeof value !== "object") return null;

	const record = value as Record<string, unknown>;
	if (typeof record.id !== "string" || typeof record.fileName !== "string") {
		return null;
	}

	const attachment: AttachmentInfo = {
		id: record.id,
		fileName: record.fileName,
	};

	if (typeof record.size === "number") attachment.size = record.size;
	if (typeof record.sizeName === "string") attachment.sizeName = record.sizeName;

	return attachment;
}
