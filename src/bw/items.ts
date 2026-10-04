import { itemTypeLabel } from "./types.ts";

/**
 * Default listing shape. Enough to identify an item and follow up with a narrow `get`,
 * with no room for passwords, notes, custom fields, or URIs to leak into logs.
 */
export interface ItemSummary {
	id: string;
	type: string;
	name: string;
	username: string | null;
	/**
	 * Whether the item carries a TOTP secret — the fact, never the secret.
	 * Without it, finding which items have 2FA means `--full-items`, which dumps
	 * every password and note in the vault to answer a boolean.
	 */
	hasTotp: boolean;
}

export function summarizeItem(item: Record<string, unknown>): ItemSummary {
	const login = item.login as Record<string, unknown> | null | undefined;
	const username = login?.username;
	const totp = login?.totp;

	return {
		id: String(item.id ?? ""),
		type: itemTypeLabel(item.type as number),
		name: String(item.name ?? ""),
		username: typeof username === "string" && username ? username : null,
		hasTotp: typeof totp === "string" && totp.length > 0,
	};
}
