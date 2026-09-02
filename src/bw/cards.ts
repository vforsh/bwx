import type { BwCard } from "./types.ts";

/**
 * Card items keep their values in a `card` object rather than in `login` or in
 * custom fields, and `bw get <field>` has no equivalent for any of them — so
 * these names are resolved here, from an item bwx has already fetched.
 *
 * A reader returns the value or `null`; naming the item and raising is the
 * caller's job, since it holds the item name and the error type.
 */
type CardReader = (card: BwCard) => string | null;

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

export type CardField = (typeof CARD_FIELDS)[number];

/**
 * How each canonical field reads off the card object. Keyed by `CardField`, so
 * adding a name to {@link CARD_FIELDS} without a reader fails to compile rather
 * than at the one call that asks for it.
 */
const CARD_READERS: Record<CardField, CardReader> = {
	number: (card) => text(card.number),
	cvv: (card) => text(card.code),
	cardholder: (card) => text(card.cardholderName),
	brand: (card) => text(card.brand),
	expiry: readExpiry,
	expMonth: readExpMonth,
	expYear: (card) => text(card.expYear),
};

/**
 * Other spellings of the same fields: bw's own JSON keys, so a name copied out
 * of `bwx get item` resolves, plus the words people reach for first.
 */
const CARD_ALIASES: Record<string, CardField> = {
	code: "cvv",
	cvc: "cvv",
	securityCode: "cvv",
	cardholderName: "cardholder",
	holder: "cardholder",
	exp: "expiry",
	expiration: "expiry",
};

/**
 * Card names are matched leniently — case, dashes, and underscores all collapse
 * — because `expMonth`, `exp-month`, and `expmonth` are the same request, and
 * failing one of them would only teach the caller to try the other two.
 */
function normalize(field: string): string {
	return field.toLowerCase().replaceAll(/[-_\s]/g, "");
}

/**
 * Every accepted spelling to its canonical field, derived so that the two
 * tables above stay the only place a card field name is written down.
 */
const CANONICAL_BY_SPELLING: Record<string, CardField> = {
	...Object.fromEntries(CARD_FIELDS.map((field) => [normalize(field), field])),
	...Object.fromEntries(
		Object.entries(CARD_ALIASES).map(([alias, field]) => [normalize(alias), field]),
	),
};

/** True when `field` names a card field rather than a login field or a custom one. */
export function isCardField(field: string): boolean {
	return normalize(field) in CANONICAL_BY_SPELLING;
}

/** Reads one card field, or `null` when the card carries no value for it. */
export function readCardValue(card: BwCard, field: string): string | null {
	const canonical = CANONICAL_BY_SPELLING[normalize(field)];
	return canonical ? CARD_READERS[canonical](card) : null;
}

/**
 * bw stores the month as the digit it was entered as ("3"), which is not what a
 * `MM` field or an expiry string wants. Padding here means every consumer gets
 * the two-digit form rather than each one remembering to pad.
 */
function readExpMonth(card: BwCard): string | null {
	return text(card.expMonth)?.padStart(2, "0") ?? null;
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
