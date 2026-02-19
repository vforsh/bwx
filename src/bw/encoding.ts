import type { BwField, BwFieldType, BwItem, BwItemType, BwUri } from "./types.ts";
import { BwFieldType as FT, BwItemType as IT } from "./types.ts";

// --- Field flag parsing ---
// k=v         → Text field
// !k=v        → Hidden field
// bool:k=v    → Boolean field

export interface ParsedField {
	name: string;
	value: string;
	type: BwFieldType;
}

export function parseFieldFlag(raw: string): ParsedField {
	if (raw.startsWith("bool:")) {
		const rest = raw.slice(5);
		const eq = rest.indexOf("=");
		if (eq === -1) return { name: rest, value: "true", type: FT.Boolean };
		return { name: rest.slice(0, eq), value: rest.slice(eq + 1), type: FT.Boolean };
	}

	if (raw.startsWith("!")) {
		const rest = raw.slice(1);
		const eq = rest.indexOf("=");
		if (eq === -1) return { name: rest, value: "", type: FT.Hidden };
		return { name: rest.slice(0, eq), value: rest.slice(eq + 1), type: FT.Hidden };
	}

	const eq = raw.indexOf("=");
	if (eq === -1) return { name: raw, value: "", type: FT.Text };
	return { name: raw.slice(0, eq), value: raw.slice(eq + 1), type: FT.Text };
}

// --- Build new item JSON ---

export interface NewItemOptions {
	type?: "login" | "note";
	name: string;
	notes?: string | null;
	username?: string | null;
	password?: string | null;
	uris?: string[];
	fields?: ParsedField[];
	folderId?: string | null;
	favorite?: boolean;
}

export function buildNewItem(options: NewItemOptions): Record<string, unknown> {
	const isLogin = options.type === "login";
	const itemType: BwItemType = isLogin ? IT.Login : IT.SecureNote;

	const item: Record<string, unknown> = {
		organizationId: null,
		collectionIds: null,
		folderId: options.folderId ?? null,
		type: itemType,
		name: options.name,
		notes: options.notes ?? null,
		favorite: options.favorite ?? false,
		reprompt: 0,
	};

	if (isLogin) {
		item.login = {
			username: options.username ?? null,
			password: options.password ?? null,
			totp: null,
			uris: options.uris?.length
				? options.uris.map((uri) => ({ match: null, uri }))
				: null,
		};
	} else {
		item.secureNote = { type: 0 };
		item.login = null;
	}

	if (options.fields?.length) {
		item.fields = options.fields.map((f) => ({
			name: f.name,
			value: f.value,
			type: f.type,
		}));
	} else {
		item.fields = null;
	}

	return item;
}

// --- Patch existing item ---

export interface PatchOptions {
	name?: string;
	notes?: string;
	username?: string;
	password?: string;
	uris?: string[];
	addFields?: ParsedField[];
	rmFields?: string[];
	folderId?: string;
	favorite?: boolean;
}

export function patchItem(
	item: Record<string, unknown>,
	patch: PatchOptions,
): Record<string, unknown> {
	const result = { ...item };

	if (patch.name !== undefined) result.name = patch.name;
	if (patch.notes !== undefined) result.notes = patch.notes;
	if (patch.folderId !== undefined) result.folderId = patch.folderId;
	if (patch.favorite !== undefined) result.favorite = patch.favorite;

	// Login fields
	if (patch.username !== undefined || patch.password !== undefined || patch.uris !== undefined) {
		const login = (result.login as Record<string, unknown>) ?? {};
		if (patch.username !== undefined) login.username = patch.username;
		if (patch.password !== undefined) login.password = patch.password;
		if (patch.uris !== undefined) {
			login.uris = patch.uris.map((uri) => ({ match: null, uri }));
		}
		result.login = login;
	}

	// Fields: remove then add
	let fields = Array.isArray(result.fields) ? [...(result.fields as BwField[])] : [];
	if (patch.rmFields?.length) {
		const removeSet = new Set(patch.rmFields);
		fields = fields.filter((f) => !removeSet.has(f.name));
	}
	if (patch.addFields?.length) {
		for (const f of patch.addFields) {
			const idx = fields.findIndex((e) => e.name === f.name);
			if (idx >= 0) {
				fields[idx] = { name: f.name, value: f.value, type: f.type };
			} else {
				fields.push({ name: f.name, value: f.value, type: f.type });
			}
		}
	}
	result.fields = fields.length > 0 ? fields : null;

	return result;
}

// --- Base64 encoding (replaces `bw encode`) ---

export function bwEncode(input: string): string {
	return Buffer.from(input).toString("base64");
}
