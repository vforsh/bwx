import { CliError, ExitCode } from "../cli/errors.ts";

/**
 * Normalizes card values on their way into the vault. Every check runs before
 * the write, because a mistyped number or expiry is otherwise discovered at the
 * checkout it was supposed to pay for.
 *
 * Errors name the flag and the rule, never the value: a card number or CVV in
 * an error message ends up in a terminal, a transcript, or a log.
 */

/** Bitwarden's own brand values, as its clients write and filter on them. */
export const CARD_BRANDS = [
	"Visa",
	"Mastercard",
	"Amex",
	"Discover",
	"Diners Club",
	"JCB",
	"Maestro",
	"UnionPay",
	"RuPay",
	"Mir",
	"Other",
] as const;

export type CardBrand = (typeof CARD_BRANDS)[number];

/** Spellings people reach for that are not the brand's canonical name. */
const BRAND_ALIASES: Record<string, CardBrand> = {
	mc: "Mastercard",
	americanexpress: "Amex",
	diners: "Diners Club",
	cup: "UnionPay",
};

function brandKey(value: string): string {
	return value.toLowerCase().replaceAll(/[-_\s]/g, "");
}

const BRAND_BY_KEY: Record<string, CardBrand> = {
	...Object.fromEntries(CARD_BRANDS.map((brand) => [brandKey(brand), brand])),
	...BRAND_ALIASES,
};

/**
 * Maps any casing of a brand to the value Bitwarden stores. An unknown brand is
 * rejected rather than stored as typed: Bitwarden's clients match brand values
 * exactly, so "visa" would show as no brand at all.
 */
export function normalizeBrand(raw: string): CardBrand {
	const brand = BRAND_BY_KEY[brandKey(raw)];
	if (!brand) {
		throw new CliError(
			`Invalid --brand "${raw}". Valid: ${CARD_BRANDS.join(", ")}`,
			ExitCode.BadArgs,
		);
	}
	return brand;
}

/**
 * IIN prefixes, most specific first so a range nested inside a broader one wins.
 * Ambiguous prefixes (RuPay shares ranges with Discover and Maestro) are left
 * out: no brand is better than a confidently wrong one.
 */
const BRAND_PREFIXES: Array<[RegExp, CardBrand]> = [
	[/^3[47]/, "Amex"],
	[/^3(0[0-5]|[68])/, "Diners Club"],
	[/^35(2[89]|[3-8])/, "JCB"],
	[/^220[0-4]/, "Mir"],
	[/^4/, "Visa"],
	[/^(5[1-5]|222[1-9]|22[3-9]|2[3-6]|27[01]|2720)/, "Mastercard"],
	[/^(6011|65|64[4-9]|622(12[6-9]|1[3-9]|[2-8]|9[01]|92[0-5]))/, "Discover"],
	[/^62/, "UnionPay"],
	[/^(5018|5020|5038|5893|6304|6759|676[1-3])/, "Maestro"],
];

/** The brand a normalized number belongs to, or `null` when it is unclear. */
export function inferBrand(number: string): CardBrand | null {
	return BRAND_PREFIXES.find(([prefix]) => prefix.test(number))?.[1] ?? null;
}

export interface CardNumberOptions {
	/** False skips the Luhn check, for test or private-label numbers. */
	luhn: boolean;
}

/**
 * Strips the spaces and dashes a number is usually written with, then requires
 * digits and a valid Luhn checksum — the check every real card number passes and
 * a single mistyped digit fails.
 */
export function normalizeCardNumber(
	raw: string,
	options: CardNumberOptions,
): string {
	const number = raw.replaceAll(/[\s-]/g, "");
	if (!/^\d{8,19}$/.test(number)) {
		throw new CliError(
			"Invalid card number: expected 8–19 digits (spaces and dashes are allowed).",
			ExitCode.BadArgs,
		);
	}
	if (options.luhn && !passesLuhn(number)) {
		throw new CliError(
			"Invalid card number: Luhn checksum failed. Pass --no-validate to store it anyway.",
			ExitCode.BadArgs,
		);
	}
	return number;
}

function passesLuhn(number: string): boolean {
	let sum = 0;
	for (let i = 0; i < number.length; i++) {
		let digit = Number(number[number.length - 1 - i]);
		if (i % 2 === 1) {
			digit *= 2;
			if (digit > 9) digit -= 9;
		}
		sum += digit;
	}
	return sum % 10 === 0;
}

export function normalizeCvv(raw: string): string {
	const cvv = raw.trim();
	if (!/^\d{3,4}$/.test(cvv)) {
		throw new CliError("Invalid CVV: expected 3 or 4 digits.", ExitCode.BadArgs);
	}
	return cvv;
}

export interface CardExpiry {
	/** As Bitwarden stores it: the month number, unpadded ("3"). */
	month: string;
	/** Always four digits. */
	year: string;
}

/** `MM/YY` or `MM/YYYY`; a one-digit month is accepted too. */
export function parseExpiry(raw: string): CardExpiry {
	const match = /^\s*(\d{1,2})\s*\/\s*(\d{2}|\d{4})\s*$/.exec(raw);
	if (!match) {
		throw new CliError(
			`Invalid --expiry "${raw}". Use MM/YY or MM/YYYY.`,
			ExitCode.BadArgs,
		);
	}
	return {
		month: parseExpMonth(match[1]!, "--expiry"),
		year: parseExpYear(match[2]!, "--expiry"),
	};
}

export function parseExpMonth(raw: string, flag = "--exp-month"): string {
	const month = /^\s*\d{1,2}\s*$/.test(raw) ? Number(raw) : Number.NaN;
	if (!Number.isInteger(month) || month < 1 || month > 12) {
		throw new CliError(
			`Invalid month in ${flag} "${raw}". Use 1–12.`,
			ExitCode.BadArgs,
		);
	}
	return String(month);
}

/**
 * A two-digit year is expanded to this century: cards are issued for a few
 * years at most, so `29` cannot reasonably mean 1929.
 */
export function parseExpYear(raw: string, flag = "--exp-year"): string {
	const year = raw.trim();
	if (/^\d{4}$/.test(year)) return year;
	if (/^\d{2}$/.test(year)) return `20${year}`;
	throw new CliError(
		`Invalid year in ${flag} "${raw}". Use YYYY (or YY).`,
		ExitCode.BadArgs,
	);
}
