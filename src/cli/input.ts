import type { Command } from "commander";
import { parseFieldFlag, type ParsedField } from "../bw/encoding.ts";
import { normalizeTotpInput } from "../bw/totp.ts";
import { CliError, ExitCode } from "./errors.ts";

export function collect(val: string, prev: string[]): string[] {
	prev.push(val);
	return prev;
}

/** Reads a single line from stdin, for the few interactive prompts bwx has. */
export async function readLine(): Promise<string> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of Bun.stdin.stream()) {
		chunks.push(chunk);
		const text = Buffer.concat(chunks).toString();
		if (text.includes("\n")) return text.split("\n")[0]!.trim();
	}
	return Buffer.concat(chunks).toString().trim();
}

/**
 * Lazily reads stdin once. Commands validate that only one explicit stdin source
 * is selected, but caching also keeps implicit legacy stdin reads predictable.
 */
export class StdinReader {
	private textPromise: Promise<string> | null = null;

	read(): Promise<string> {
		this.textPromise ??= readStdinText();
		return this.textPromise;
	}
}

export interface TextSource {
	label: string;
	inline?: string;
	stdin?: boolean;
	file?: string;
	env?: string;
	/** Produces the value instead of reading it — see `--password-generate`. */
	generate?: () => Promise<string>;
	flagNames: string[];
	allowEmpty?: boolean;
}

export interface FieldSources {
	inline: string[];
	file: string[];
	env: string[];
	fileFlag: string;
	envFlag: string;
	stdin: StdinReader;
}

export interface ItemTextInputs {
	notes?: string;
	notesFile?: string;
	password?: string;
	passwordStdin?: boolean;
	passwordFile?: string;
	passwordEnv?: string;
	passwordGenerate?: boolean;
	totp?: string;
	totpStdin?: boolean;
	totpFile?: string;
	totpEnv?: string;
}

export interface ResolvedItemTextInputs {
	notes?: string;
	password?: string;
	/** True when the password was generated, so callers can keep it unprinted. */
	passwordGenerated?: boolean;
	/** Normalized and validated by {@link normalizeTotpInput} before it is stored. */
	totp?: string;
}

export interface ExplicitStdinInputs extends ItemTextInputs {
	fieldFileFlag?: string;
	fieldFiles?: string[];
}

/** Which slot of a {@link TextSource} a flag fills. */
type TextSourceKind = "inline" | "stdin" | "file" | "env" | "generate";

interface TextInputFlag {
	/** Commander option spec, e.g. `--password-file <path>`. */
	spec: string;
	description: string;
	/** The property commander derives from `spec`. */
	key: keyof ItemTextInputs;
	kind: TextSourceKind;
}

/**
 * One value a caller can supply, and every flag that can supply it. Option
 * registration, the "choose only one source" error, the stdin-conflict check and
 * the login-only guard all read from here, so adding a source touches one table
 * rather than both write commands and three hand-kept lists.
 */
export interface TextInputFamily {
	/** Names the value in error messages. */
	label: string;
	flags: TextInputFlag[];
	/** True when only a login item has anywhere to store the value. */
	loginOnly: boolean;
	/** Whether empty is a legitimate value — it is, for notes. */
	allowEmpty?: boolean;
}

const NOTES_FAMILY: TextInputFamily = {
	label: "notes",
	loginOnly: false,
	allowEmpty: true,
	flags: [
		{
			spec: "--notes <text>",
			description: "Notes content",
			key: "notes",
			kind: "inline",
		},
		{
			spec: "--notes-file <path>",
			description: "Read notes from file (use - for stdin)",
			key: "notesFile",
			kind: "file",
		},
	],
};

const PASSWORD_FAMILY: TextInputFamily = {
	label: "password",
	loginOnly: true,
	flags: [
		{
			spec: "--password <pass>",
			description: "Password (login items only)",
			key: "password",
			kind: "inline",
		},
		{
			spec: "--password-stdin",
			description: "Read password from stdin",
			key: "passwordStdin",
			kind: "stdin",
		},
		{
			spec: "--password-file <path>",
			description: "Read password from file (use - for stdin)",
			key: "passwordFile",
			kind: "file",
		},
		{
			spec: "--password-env <name>",
			description: "Read password from environment variable",
			key: "passwordEnv",
			kind: "env",
		},
		{
			spec: "--password-generate",
			description: "Generate the password; it is never printed",
			key: "passwordGenerate",
			kind: "generate",
		},
	],
};

export const TOTP_FAMILY: TextInputFamily = {
	label: "TOTP secret",
	loginOnly: true,
	flags: [
		{
			spec: "--totp <secret>",
			description: "TOTP secret: base32 or otpauth:// URI (login items only)",
			key: "totp",
			kind: "inline",
		},
		{
			spec: "--totp-stdin",
			description: "Read the TOTP secret from stdin",
			key: "totpStdin",
			kind: "stdin",
		},
		{
			spec: "--totp-file <path>",
			description: "Read the TOTP secret from file (use - for stdin)",
			key: "totpFile",
			kind: "file",
		},
		{
			spec: "--totp-env <name>",
			description: "Read the TOTP secret from environment variable",
			key: "totpEnv",
			kind: "env",
		},
	],
};

const ITEM_TEXT_FAMILIES = [NOTES_FAMILY, PASSWORD_FAMILY, TOTP_FAMILY];

function flagName(spec: string): string {
	return spec.split(" ")[0]!;
}

function sourceFlagNames(family: TextInputFamily): string[] {
	return family.flags.map((flag) => flagName(flag.spec));
}

/**
 * Registers every flag that can supply notes, a password, or a TOTP secret, plus
 * the length modifier `--password-generate` takes. `create` and `edit` accept the
 * identical set and {@link resolveItemTextInputs} is their only reader, so the
 * set is declared once here instead of per command.
 */
export function registerItemTextOptions(command: Command): Command {
	for (const family of ITEM_TEXT_FAMILIES) {
		for (const flag of family.flags) {
			command.option(flag.spec, flag.description);
		}
	}

	return command.option(
		"--generate-length <n>",
		"Length for --password-generate",
		(value) => Number.parseInt(value, 10),
	);
}

/**
 * The `[key, flag]` pairs a command must reject on a non-login item, because
 * `buildNewItem` and `patchItem` have nowhere to put them and would accept the
 * value only to drop it.
 */
export function loginOnlyTextInputFlags(): Array<[keyof ItemTextInputs, string]> {
	return ITEM_TEXT_FAMILIES.filter((family) => family.loginOnly).flatMap(
		(family) =>
			family.flags.map(
				(flag) =>
					[flag.key, flagName(flag.spec)] as [keyof ItemTextInputs, string],
			),
	);
}

/** The flags a caller actually used to supply this family's value. */
export function listUsedSourceFlags(
	family: TextInputFamily,
	inputs: ItemTextInputs,
): string[] {
	return family.flags
		.filter((flag) => inputs[flag.key] !== undefined)
		.map((flag) => flagName(flag.spec));
}

export async function resolveItemTextInputs(
	inputs: ItemTextInputs,
	stdin: StdinReader,
	generatePassword?: () => Promise<string>,
): Promise<ResolvedItemTextInputs> {
	assertSingleStdinSource(listExplicitStdinInputs(inputs));

	const [notes, password, totp] = await Promise.all([
		resolveOptionalTextSource(
			{
				label: NOTES_FAMILY.label,
				inline: inputs.notes,
				file: inputs.notesFile,
				flagNames: sourceFlagNames(NOTES_FAMILY),
				allowEmpty: NOTES_FAMILY.allowEmpty,
			},
			stdin,
		),
		resolveOptionalTextSource(
			{
				label: PASSWORD_FAMILY.label,
				inline: inputs.password,
				stdin: inputs.passwordStdin,
				file: inputs.passwordFile,
				env: inputs.passwordEnv,
				generate:
					inputs.passwordGenerate && generatePassword
						? generatePassword
						: undefined,
				flagNames: sourceFlagNames(PASSWORD_FAMILY),
			},
			stdin,
		),
		resolveOptionalTextSource(
			{
				label: TOTP_FAMILY.label,
				inline: inputs.totp,
				stdin: inputs.totpStdin,
				file: inputs.totpFile,
				env: inputs.totpEnv,
				flagNames: sourceFlagNames(TOTP_FAMILY),
			},
			stdin,
		),
	]);

	return {
		notes,
		password,
		passwordGenerated: inputs.passwordGenerate ?? false,
		// Validated here rather than at the call sites so every write path gets
		// the check: a malformed seed is only ever noticed at the login it breaks.
		totp: totp === undefined ? undefined : normalizeTotpInput(totp),
	};
}

export function listExplicitStdinInputs(inputs: ExplicitStdinInputs): string[] {
	const sources: string[] = [];

	for (const family of ITEM_TEXT_FAMILIES) {
		for (const flag of family.flags) {
			const name = flagName(flag.spec);
			if (flag.kind === "stdin" && inputs[flag.key]) {
				sources.push(name);
			} else if (flag.kind === "file" && inputs[flag.key] === "-") {
				sources.push(`${name} -`);
			}
		}
	}

	if (inputs.fieldFileFlag && inputs.fieldFiles) {
		sources.push(
			...stdinSourcesForFieldFiles(inputs.fieldFileFlag, inputs.fieldFiles),
		);
	}

	return sources;
}

export async function resolveOptionalTextSource(
	source: TextSource,
	stdin: StdinReader,
): Promise<string | undefined> {
	const selected = [
		source.inline !== undefined ? "inline" : null,
		source.stdin ? "stdin" : null,
		source.file !== undefined ? "file" : null,
		source.env !== undefined ? "env" : null,
		source.generate !== undefined ? "generate" : null,
	].filter((value): value is string => value !== null);

	if (selected.length > 1) {
		throw new CliError(
			`Choose only one ${source.label} source: ${source.flagNames.join(", ")}`,
			ExitCode.BadArgs,
		);
	}

	if (selected.length === 0) return undefined;

	let value: string;
	if (source.inline !== undefined) {
		value = source.inline;
	} else if (source.stdin) {
		value = await stdin.read();
	} else if (source.file !== undefined) {
		value = await readFileOrStdin(source.file, stdin, source.label);
	} else if (source.generate !== undefined) {
		value = await source.generate();
	} else {
		value = readEnvValue(source.env!, source.label);
	}

	if (!source.allowEmpty && value.length === 0) {
		throw new CliError(`${capitalize(source.label)} cannot be empty`, ExitCode.BadArgs);
	}

	return value;
}

export async function resolveFieldSources(
	sources: FieldSources,
): Promise<ParsedField[]> {
	const fields = sources.inline.map(parseFieldFlag);

	for (const raw of sources.file) {
		const field = parseRequiredSourceField(raw, sources.fileFlag);
		fields.push({
			...field,
			value: await readFileOrStdin(field.value, sources.stdin, field.name),
		});
	}

	for (const raw of sources.env) {
		const field = parseRequiredSourceField(raw, sources.envFlag);
		fields.push({
			...field,
			value: readEnvValue(field.value, field.name),
		});
	}

	return fields;
}

export function assertSingleStdinSource(sources: string[]): void {
	if (sources.length <= 1) return;
	throw new CliError(
		`Only one stdin input source can be used at a time: ${sources.join(", ")}`,
		ExitCode.BadArgs,
	);
}

export function stdinSourcesForFieldFiles(flag: string, raws: string[]): string[] {
	return raws
		.filter((raw) => parseRequiredSourceField(raw, flag).value === "-")
		.map((raw) => `${flag} ${raw}`);
}

export async function readOptionalStdin(stdin: StdinReader): Promise<string | null> {
	const text = await stdin.read();
	return text.length > 0 ? text : null;
}

function parseRequiredSourceField(raw: string, flag: string): ParsedField {
	if (!raw.includes("=")) {
		throw new CliError(`Expected ${flag} k=value`, ExitCode.BadArgs);
	}

	const field = parseFieldFlag(raw);
	if (field.value.length === 0) {
		throw new CliError(`Expected ${flag} ${field.name}=value`, ExitCode.BadArgs);
	}

	return field;
}

async function readFileOrStdin(
	path: string,
	stdin: StdinReader,
	label: string,
): Promise<string> {
	if (path === "-") return stdin.read();

	try {
		return stripFinalNewline(await Bun.file(path).text());
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new CliError(
			`Failed to read ${label} from "${path}": ${message}`,
			ExitCode.BadArgs,
		);
	}
}

function readEnvValue(name: string, label: string): string {
	if (!Object.prototype.hasOwnProperty.call(process.env, name)) {
		throw new CliError(
			`Environment variable ${name} is not set for ${label}`,
			ExitCode.BadArgs,
		);
	}
	return process.env[name] ?? "";
}

async function readStdinText(): Promise<string> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of Bun.stdin.stream()) {
		chunks.push(chunk);
	}
	return stripFinalNewline(Buffer.concat(chunks).toString());
}

function stripFinalNewline(text: string): string {
	return text.replace(/\r?\n$/, "");
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
