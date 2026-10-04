import { CliError, ExitCode } from "../cli/errors.ts";
import { CARD_FIELDS, readCardValue } from "./cards.ts";
import { builtinReference, customReference, ITEM_ID_RE } from "./references.ts";
import { BwItemSchema, BwItemType, customFieldTypeLabel, itemTypeLabel } from "./types.ts";

export interface DiscoveredField {
	kind: "builtin" | "custom";
	name: string;
	type: "text" | "hidden" | "boolean" | "totp";
	ref: string;
}

export interface ItemDiscovery {
	id: string;
	type: string;
	name: string;
	fields: DiscoveredField[];
}

function present(value: unknown): boolean {
	return typeof value === "string" && value !== "";
}

/** Explicit allowlist: no spreading raw items or carrying field values forward. */
export function discoverItem(raw: Record<string, unknown>): ItemDiscovery {
	const item = BwItemSchema.parse(raw);
	if (!ITEM_ID_RE.test(item.id)) {
		throw new CliError("Invalid vault item ID", ExitCode.BwError);
	}
	const fields: DiscoveredField[] = [];
	const addBuiltin = (name: string, type: DiscoveredField["type"], available: boolean) => {
		if (!available) return;
		fields.push({ kind: "builtin", name, type, ref: builtinReference(item.id, name) });
	};
	addBuiltin("notes", "text", present(item.notes));
	if (item.type === BwItemType.Login) {
		addBuiltin("username", "text", present(item.login?.username));
		addBuiltin("password", "hidden", present(item.login?.password));
		addBuiltin("uri", "text", present(item.login?.uris?.[0]?.uri));
		addBuiltin("totp", "totp", present(item.login?.totp));
	}
	if (item.type === BwItemType.Card && item.card) {
		for (const name of CARD_FIELDS) {
			const type = name === "number" || name === "cvv" ? "hidden" : "text";
			addBuiltin(name, type, readCardValue(item.card, name) !== null);
		}
	}
	for (const [index, field] of (item.fields ?? []).entries()) {
		const type = customFieldTypeLabel(field.type);
		if (type === undefined) continue; // Linked/unknown types have no supported value reader.
		fields.push({
			kind: "custom",
			name: field.name,
			type,
			ref: customReference(item.id, index, field.name),
		});
	}
	return { id: item.id, type: itemTypeLabel(item.type), name: item.name, fields };
}
