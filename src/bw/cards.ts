import type { BwCard } from "./types.ts";

/**
 * Card items keep their secrets in a `card` object rather than in `login` or in
 * custom fields, and `bw get <field>` has no equivalent for any of them — so
 * these names are resolved here, from an item bwx has already fetched.
 *
 * The value is returned or `null`; naming the item and raising is the caller's
 * job, since it holds the item name and the error type.
 */
type CardReader = (card: BwCard) => string | null;

/**
 * Every accepted spelling, normalized (see {@link normalizeCardField}). bw's own
 * JSON keys are in here alongside the words people actually say, so a name
 * copied out of `bwx get item` works and so does the one you'd guess.
 */
const CARD_READERS: Record<string, CardReader> = {
	number: (card) => text(card.number),
	cvv: (card) => text(card.code),
	cvc: (card) => text(card.code),
	code: (card) => text(card.code),
	securitycode: (card) => text(card.code),
	cardholder: (card) => text(card.cardholderName),
	cardholdername: (card) => text(card.cardholderName),
	holder: (card) => text(card.cardholderName),
	brand: (card) => text(card.brand),
	expmonth: readExpMonth,
	expyear: (card) => text(card.expYear),
	expiry: readExpiry,
	exp: readExpiry,
	expiration: readExpiry,
};

/** Canonical names, in the order help text and errors list them. */
export const CARD_FIELDS = [
	"number",
	"cvv",
	"cardholder",
	"brand",
	"expiry",
	"expMonth",
	"expYear",
] as const;

/**
 * Card names are matched leniently — case, dashes, and underscores all collapse
 * — because `expMonth`, `exp-month`, and `expmonth` are the same request, and
 * failing one of them would only teach the caller to try the other two.
 */
function normalizeCardField(field: string): string {
	return field.toLowerCase().replaceAll(/[-_\s]/g, "");
}

/** True when `field` names a card field rather than a login field or a custom one. */
export function isCardField(field: string): boolean {
	return normalizeCardField(field) in CARD_READERS;
}

/**
 * Reads one card field, or `null` when the card carries no value for it. Call
 * only for a `field` {@link isCardField} accepts.
 */
export function readCardValue(card: BwCard, field: string): string | null {
	return CARD_READERS[normalizeCardField(field)]?.(card) ?? null;
}

/**
 * bw stores the month as the digit it was entered as ("3"), which is not what a
 * `MM` field or an expiry string wants. Padding here means every consumer gets
 * the two-digit form rather than each one remembering to pad.
 */
function readExpMonth(card: BwCard): string | null {
	const month = text(card.expMonth);
	if (!month) return null;
	return /^\d$/.test(month) ? `0${month}` : month;
}

/**
 * Composed rather than stored: Bitwarden keeps month and year apart, and a
 * caller filling one expiry box should not have to join them itself. The year
 * is passed through as stored, so a vault holding `30` yields `03/30`.
 */
function readExpiry(card: BwCard): string | null {
	const month = readExpMonth(card);
	const year = text(card.expYear);
	// Half an expiry is worse than none — it would read as a complete date.
	return month && year ? `${month}/${year}` : null;
}

/**
 * Normalizes a stored value to a non-empty string. Months and years arrive as
 * either strings or numbers depending on how the item was created, and an empty
 * string means "not set" just as much as `null` does.
 */
function text(value: string | number | null | undefined): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = String(value).trim();
	return trimmed === "" ? null : trimmed;
}
