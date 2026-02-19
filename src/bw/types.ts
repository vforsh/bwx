import { z } from "zod/v4";

// --- Vault status ---

export const BwStatusSchema = z.object({
	serverUrl: z.string().nullable(),
	lastSync: z.string().nullable(),
	userEmail: z.string().nullable(),
	userId: z.string().nullable(),
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
	note: BwItemType.SecureNote,
	card: BwItemType.Card,
	identity: BwItemType.Identity,
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

// --- Item (loose schema — passthrough for edit round-trip) ---

export const BwItemSchema = z
	.object({
		id: z.string(),
		organizationId: z.string().nullable(),
		folderId: z.string().nullable(),
		type: z.number(),
		name: z.string(),
		notes: z.string().nullable(),
		favorite: z.boolean(),
		fields: z
			.array(
				z.object({
					name: z.string(),
					value: z.string().nullable(),
					type: z.number(),
				}),
			)
			.nullable(),
		login: z
			.object({
				username: z.string().nullable(),
				password: z.string().nullable(),
				totp: z.string().nullable(),
				uris: z
					.array(
						z.object({
							match: z.number().nullable().optional(),
							uri: z.string(),
						}),
					)
					.nullable(),
			})
			.nullable()
			.optional(),
		reprompt: z.number().optional(),
	})
	.passthrough();

export type BwItem = z.infer<typeof BwItemSchema>;
