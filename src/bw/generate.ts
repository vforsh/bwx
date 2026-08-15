import { CliError, ExitCode } from "../cli/errors.ts";
import { runBwOrThrow } from "./runner.ts";

/**
 * `bw generate` is local — it needs no session and no unlocked vault, so a
 * generated secret costs one fast spawn and never touches the network.
 */

export interface GenerateOptions {
	length?: number;
	passphrase?: boolean;
	words?: number;
	separator?: string;
	capitalize?: boolean;
	includeNumber?: boolean;
	uppercase?: boolean;
	lowercase?: boolean;
	numbers?: boolean;
	special?: boolean;
	ambiguous?: boolean;
}

/** bw's own defaults, restated here so `--no-numbers` can turn one off without
 * silently disabling the rest: bw needs every wanted character set named. */
const CHARSET_DEFAULTS = {
	uppercase: true,
	lowercase: true,
	numbers: true,
	special: false,
} as const;

export function buildGenerateArgs(options: GenerateOptions): string[] {
	const args = ["generate"];

	if (options.passphrase) {
		args.push("--passphrase");
		if (options.words !== undefined) args.push("--words", String(options.words));
		if (options.separator !== undefined) {
			args.push("--separator", options.separator);
		}
		if (options.capitalize) args.push("--capitalize");
		if (options.includeNumber) args.push("--includeNumber");
		return args;
	}

	const charsets = {
		uppercase: options.uppercase ?? CHARSET_DEFAULTS.uppercase,
		lowercase: options.lowercase ?? CHARSET_DEFAULTS.lowercase,
		numbers: options.numbers ?? CHARSET_DEFAULTS.numbers,
		special: options.special ?? CHARSET_DEFAULTS.special,
	};

	if (!Object.values(charsets).some(Boolean)) {
		throw new CliError(
			"At least one character set must stay enabled.",
			ExitCode.BadArgs,
		);
	}

	if (options.length !== undefined) {
		if (!Number.isInteger(options.length) || options.length < 5) {
			throw new CliError(
				`Invalid --length "${options.length}". Use an integer of at least 5.`,
				ExitCode.BadArgs,
			);
		}
		args.push("--length", String(options.length));
	}

	if (charsets.uppercase) args.push("--uppercase");
	if (charsets.lowercase) args.push("--lowercase");
	if (charsets.numbers) args.push("--number");
	if (charsets.special) args.push("--special");
	if (options.ambiguous) args.push("--ambiguous");

	return args;
}

export async function generateSecret(
	options: GenerateOptions,
): Promise<string> {
	const value = await runBwOrThrow(buildGenerateArgs(options), {
		session: null,
	});

	if (!value) {
		throw new CliError("bw generate returned nothing", ExitCode.BwError);
	}

	return value;
}
