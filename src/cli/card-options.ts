import type { Command } from "commander";
import type { BwCard } from "../bw/types.ts";
import {
	inferBrand,
	normalizeBrand,
	parseExpiry,
	parseExpMonth,
	parseExpYear,
} from "../bw/card-input.ts";
import { CliError, ExitCode } from "./errors.ts";
import {
	CARD_NUMBER_FAMILY,
	CVV_FAMILY,
	listUsedSourceFlags,
	typeOnlyTextInputFlags,
	type ItemTextInputs,
	type ResolvedItemTextInputs,
} from "./input.ts";

/**
 * The card values that are not secrets. The number and CVV are secrets, so they
 * live in the shared text-input table with every other `--x-stdin|file|env`
 * family; these are plain flags.
 */
export interface CardOptionInputs {
	cardholder?: string;
	brand?: string;
	expiry?: string;
	expMonth?: string;
	expYear?: string;
}

/** `edit` only: clearing a value is different from leaving it alone. */
export interface CardRemovalInputs {
	rmNumber?: boolean;
	rmCvv?: boolean;
	rmCardholder?: boolean;
	rmBrand?: boolean;
	rmExpiry?: boolean;
}

type CardInputs = CardOptionInputs & CardRemovalInputs & ItemTextInputs;

const CARD_OPTION_FLAGS: Array<[keyof CardOptionInputs, string]> = [
	["cardholder", "--cardholder"],
	["brand", "--brand"],
	["expiry", "--expiry"],
	["expMonth", "--exp-month"],
	["expYear", "--exp-year"],
];

const CARD_REMOVAL_FLAGS: Array<[keyof CardRemovalInputs, string]> = [
	["rmNumber", "--rm-number"],
	["rmCvv", "--rm-cvv"],
	["rmCardholder", "--rm-cardholder"],
	["rmBrand", "--rm-brand"],
	["rmExpiry", "--rm-expiry"],
];

export function registerCardOptions(command: Command): Command {
	return command
		.option("--cardholder <name>", "Cardholder name (card items only)")
		.option("--brand <brand>", "Card brand, e.g. Visa, Mastercard, Amex (inferred from the number if omitted)")
		.option("--expiry <MM/YY>", "Expiry as MM/YY or MM/YYYY")
		.option("--exp-month <1-12>", "Expiry month")
		.option("--exp-year <YYYY>", "Expiry year");
}

export function registerCardRemovalOptions(command: Command): Command {
	return command
		.option("--rm-number", "Remove the stored card number")
		.option("--rm-cvv", "Remove the stored CVV")
		.option("--rm-cardholder", "Remove the stored cardholder name")
		.option("--rm-brand", "Remove the stored brand")
		.option("--rm-expiry", "Remove the stored expiry month and year");
}

/**
 * Every card-only flag the caller used — the set a command must reject on an
 * item that has no card object to store them in.
 */
export function usedCardOnlyFlags(inputs: CardInputs): string[] {
	const pairs: Array<[keyof CardInputs, string]> = [
		...typeOnlyTextInputFlags("card"),
		...CARD_OPTION_FLAGS,
		...CARD_REMOVAL_FLAGS,
	];
	return pairs.filter(([key]) => Boolean(inputs[key])).map(([, flag]) => flag);
}

/**
 * Turns the parsed flags into the card keys to write: a value sets a key, `null`
 * clears it, and a key left out is left alone. `current` is the card being
 * edited, so a brand is only inferred onto a card that has none.
 */
export function resolveCardPatch(
	inputs: CardInputs,
	secrets: ResolvedItemTextInputs,
	current?: BwCard | null,
): BwCard {
	const card: BwCard = {};

	if (secrets.number !== undefined) card.number = secrets.number;
	if (inputs.rmNumber) card.number = null;

	if (secrets.cvv !== undefined) card.code = secrets.cvv;
	if (inputs.rmCvv) card.code = null;

	if (inputs.cardholder !== undefined) card.cardholderName = inputs.cardholder;
	if (inputs.rmCardholder) card.cardholderName = null;

	if (inputs.brand !== undefined) {
		card.brand = normalizeBrand(inputs.brand);
	} else if (inputs.rmBrand) {
		card.brand = null;
	} else if (card.number && !current?.brand) {
		const inferred = inferBrand(card.number);
		if (inferred) card.brand = inferred;
	}

	if (inputs.expiry !== undefined) {
		const expiry = parseExpiry(inputs.expiry);
		card.expMonth = expiry.month;
		card.expYear = expiry.year;
	}
	if (inputs.expMonth !== undefined) card.expMonth = parseExpMonth(inputs.expMonth);
	if (inputs.expYear !== undefined) card.expYear = parseExpYear(inputs.expYear);
	if (inputs.rmExpiry) {
		card.expMonth = null;
		card.expYear = null;
	}

	return card;
}

/**
 * Setting and clearing the same value in one call has no sensible winner, and
 * `--expiry` already names both halves `--exp-month` and `--exp-year` would set.
 * Checked before any value is read, so a rejected call never consumes stdin.
 */
export function assertCardIntent(inputs: CardInputs): void {
	const conflicts: Array<[boolean | undefined, string, string[]]> = [
		[inputs.expiry !== undefined, "--expiry", usedOptionFlags(inputs, ["expMonth", "expYear"])],
		[inputs.rmNumber, "--rm-number", listUsedSourceFlags(CARD_NUMBER_FAMILY, inputs)],
		[inputs.rmCvv, "--rm-cvv", listUsedSourceFlags(CVV_FAMILY, inputs)],
		[inputs.rmCardholder, "--rm-cardholder", usedOptionFlags(inputs, ["cardholder"])],
		[inputs.rmBrand, "--rm-brand", usedOptionFlags(inputs, ["brand"])],
		[inputs.rmExpiry, "--rm-expiry", usedOptionFlags(inputs, ["expiry", "expMonth", "expYear"])],
	];

	for (const [active, flag, setters] of conflicts) {
		if (active && setters.length > 0) {
			throw new CliError(
				`${flag} cannot be combined with ${setters.join(", ")}.`,
				ExitCode.BadArgs,
			);
		}
	}
}

/** The flags among `keys` the caller passed, in help-text order. */
function usedOptionFlags(
	inputs: CardOptionInputs,
	keys: Array<keyof CardOptionInputs>,
): string[] {
	return CARD_OPTION_FLAGS.filter(
		([key]) => keys.includes(key) && inputs[key] !== undefined,
	).map(([, flag]) => flag);
}
