import { z } from "zod/v4";

// --- Vault status ---

export const BwStatusSchema = z.object({
	serverUrl: z.string().nullable(),
	lastSync: z.string().nullable(),
	userEmail: z.string().nullable().optional(),
	userId: z.string().nullable().optional(),
	status: z.enum(["unlocked", "locked", "unauthenticated"]),
});

export type BwStatus = z.infer<typeof BwStatusSchema>;

// --- Item types ---

export const BwItemType = {
	Login: 1,
	SecureNote: 2,
	Card: 3,
	Identity: 4,
} as const;

export type BwItemType = (typeof BwItemType)[keyof typeof BwItemType];

export const BW_TYPE_LABELS: Record<number, string> = {
	1: "login",
	2: "note",
	3: "card",
	4: "identity",
};

/** The label for an item type, naming the raw number for one bwx predates. */
export function itemTypeLabel(type: number): string {
	return BW_TYPE_LABELS[type] ?? `type:${type}`;
}

export const BW_TYPE_FROM_NAME: Record<string, BwItemType> = {
	login: BwItemType.Login,
	logins: BwItemType.Login,
	note: BwItemType.SecureNote,
	notes: BwItemType.SecureNote,
	card: BwItemType.Card,
	cards: BwItemType.Card,
	identity: BwItemType.Identity,
	identities: BwItemType.Identity,
};

// --- Field types ---

export const BwFieldType = {
	Text: 0,
	Hidden: 1,
	Boolean: 2,
} as const;

export type BwFieldType = (typeof BwFieldType)[keyof typeof BwFieldType];

/** Only these custom field types have a supported value reader. */
export function customFieldTypeLabel(
	type: number,
): "text" | "hidden" | "boolean" | undefined {
	switch (type) {
		case BwFieldType.Text:
			return "text";
		case BwFieldType.Hidden:
			return "hidden";
		case BwFieldType.Boolean:
			return "boolean";
		default:
			return undefined;
	}
}

export interface BwField {
	name: string;
	value: string;
	type: BwFieldType;
}

// --- URI ---

export interface BwUri {
	match: null;
	uri: string;
}

// --- Login ---

export interface BwLogin {
	username: string | null;
	password: string | null;
	totp: string | null;
	uris: BwUri[] | null;
}

// --- Card ---

/**
 * Values arrive as strings from `bw`, but `expMonth`/`expYear` are numbers in
 * some hand-written and imported items, so both are accepted rather than
 * failing the whole item parse over a field the caller may not even want. Every
 * key is optional for the same reason — see the schema below.
 */
export interface BwCard {
	cardholderName?: string | null;
	brand?: string | null;
	number?: string | null;
	expMonth?: string | number | null;
	expYear?: string | number | null;
	code?: string | null;
}

// --- Item (loose schema — passthrough for edit round-trip) ---

/**
 * `bw get item` omits keys it has no value for rather than nulling them — an
 * unfiled card has no `folderId`, a login without 2FA no `totp` — so every key
 * but an item's identity is optional as well as nullable. Requiring them made
 * an absent key fail the parse and took down reads of the fields that were
 * present.
 */
const OmittableTextSchema = z.string().nullable().optional();

export const BwItemSchema = z
	.object({
		id: z.string(),
		organizationId: OmittableTextSchema,
		folderId: OmittableTextSchema,
		type: z.number(),
		name: z.string(),
		notes: OmittableTextSchema,
		favorite: z.boolean().optional(),
		fields: z
			.array(
				z.object({
					name: z.string(),
					value: z.string().nullable(),
					type: z.number(),
				}),
			)
			.nullable()
			.optional(),
		login: z
			.object({
				username: OmittableTextSchema,
				password: OmittableTextSchema,
				totp: OmittableTextSchema,
				uris: z
					.array(
						z.object({
							match: z.number().nullable().optional(),
							uri: z.string(),
						}),
					)
					.nullable()
					.optional(),
			})
			.passthrough()
			.nullable()
			.optional(),
		card: z
			.object({
				cardholderName: OmittableTextSchema,
				brand: OmittableTextSchema,
				number: OmittableTextSchema,
				// Numeric in items written by hand or by an importer.
				expMonth: z.union([z.string(), z.number()]).nullable().optional(),
				expYear: z.union([z.string(), z.number()]).nullable().optional(),
				code: OmittableTextSchema,
			})
			.passthrough()
			.nullable()
			.optional(),
		reprompt: z.number().optional(),
	})
	.passthrough();

export type BwItem = z.infer<typeof BwItemSchema>;
