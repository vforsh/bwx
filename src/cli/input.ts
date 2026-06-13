import { parseFieldFlag, type ParsedField } from "../bw/encoding.ts";
import { CliError, ExitCode } from "./errors.ts";

export function collect(val: string, prev: string[]): string[] {
	prev.push(val);
	return prev;
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
}

export interface ResolvedItemTextInputs {
	notes?: string;
	password?: string;
}

export interface ExplicitStdinInputs extends ItemTextInputs {
	fieldFileFlag?: string;
	fieldFiles?: string[];
}

const NOTE_SOURCE_FLAGS = ["--notes", "--notes-file"];
const PASSWORD_SOURCE_FLAGS = [
	"--password",
	"--password-stdin",
	"--password-file",
	"--password-env",
];

export async function resolveItemTextInputs(
	inputs: ItemTextInputs,
	stdin: StdinReader,
): Promise<ResolvedItemTextInputs> {
	assertSingleStdinSource(listExplicitStdinInputs(inputs));

	const [notes, password] = await Promise.all([
		resolveOptionalTextSource(
			{
				label: "notes",
				inline: inputs.notes,
				file: inputs.notesFile,
				flagNames: NOTE_SOURCE_FLAGS,
				allowEmpty: true,
			},
			stdin,
		),
		resolveOptionalTextSource(
			{
				label: "password",
				inline: inputs.password,
				stdin: inputs.passwordStdin,
				file: inputs.passwordFile,
				env: inputs.passwordEnv,
				flagNames: PASSWORD_SOURCE_FLAGS,
			},
			stdin,
		),
	]);

	return { notes, password };
}

export function listExplicitStdinInputs(inputs: ExplicitStdinInputs): string[] {
	return [
		inputs.notesFile === "-" ? "--notes-file -" : null,
		inputs.passwordStdin ? "--password-stdin" : null,
		inputs.passwordFile === "-" ? "--password-file -" : null,
		...(inputs.fieldFileFlag && inputs.fieldFiles
			? stdinSourcesForFieldFiles(inputs.fieldFileFlag, inputs.fieldFiles)
			: []),
	].filter((value): value is string => value !== null);
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
