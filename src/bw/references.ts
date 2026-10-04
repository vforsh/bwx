import { CliError, ExitCode } from "../cli/errors.ts";
import { CARD_FIELDS } from "./cards.ts";
import type { FieldRequest } from "./fields.ts";

export const REFERENCE_PREFIX = "bwx://";
export const ITEM_ID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE_BUILTINS: readonly string[] = [
	"username",
	"password",
	"totp",
	"notes",
	"uri",
	...CARD_FIELDS,
];

export function builtinReference(id: string, field: string): string {
	return `${REFERENCE_PREFIX}${id}/builtin/${field}`;
}

/** Index distinguishes duplicate and empty custom names; name guards against moves. */
export function customReference(id: string, index: number, name: string): string {
	return `${REFERENCE_PREFIX}${id}/custom/${index}/${encodeURIComponent(name)}`;
}

/** Parse directly: URL normalization would change custom names such as '.' or '..'. */
export function parseFieldReference(ref: string): FieldRequest {
	if (!ref.startsWith(REFERENCE_PREFIX)) throw invalidReference();
	const [id, kind, ...parts] = ref.slice(REFERENCE_PREFIX.length).split("/");
	if (!id || !ITEM_ID_RE.test(id)) throw invalidReference();
	if (kind === "builtin" && parts.length === 1 && REFERENCE_BUILTINS.includes(parts[0]!)) {
		return { item: id, field: parts[0]!, options: { exactItemId: true } };
	}
	if (kind !== "custom" || parts.length !== 2 || !/^(0|[1-9]\d*)$/.test(parts[0]!)) {
		throw invalidReference();
	}
	const index = Number(parts[0]);
	if (!Number.isSafeInteger(index)) throw invalidReference();
	let name: string;
	try {
		name = decodeURIComponent(parts[1]!);
	} catch {
		throw invalidReference();
	}
	if (encodeURIComponent(name) !== parts[1]) throw invalidReference();
	return {
		item: id,
		field: name,
		options: { exactItemId: true, customOnly: true, customIndex: index },
	};
}

function invalidReference(): CliError {
	return new CliError(
		"Invalid field reference. Copy a ref from 'bwx search <query> --fields'.",
		ExitCode.BadArgs,
	);
}
