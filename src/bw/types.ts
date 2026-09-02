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

export const BwItemSchema = z
	.object({
		id: z.string(),
		// `bw get item` omits unset keys rather than nulling them — a card with no
		// folder has no `folderId` at all — so everything but the identity of the
		// item is optional. Requiring them made an absent key fail the parse and
		// took down reads of fields that were present.
		organizationId: z.string().nullable().optional(),
		folderId: z.string().nullable().optional(),
		type: z.number(),
		name: z.string(),
		notes: z.string().nullable().optional(),
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
				username: z.string().nullable().optional(),
				password: z.string().nullable().optional(),
				totp: z.string().nullable().optional(),
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
		// Every key optional and passthrough on top: a card bwx cannot fully
		// describe must still parse, or an unrelated `get password` would fail
		// on a vault that merely contains one.
		card: z
			.object({
				cardholderName: z.string().nullable().optional(),
				brand: z.string().nullable().optional(),
				number: z.string().nullable().optional(),
				expMonth: z.union([z.string(), z.number()]).nullable().optional(),
				expYear: z.union([z.string(), z.number()]).nullable().optional(),
				code: z.string().nullable().optional(),
			})
			.passthrough()
			.nullable()
			.optional(),
		reprompt: z.number().optional(),
	})
	.passthrough();

export type BwItem = z.infer<typeof BwItemSchema>;
