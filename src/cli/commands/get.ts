import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData } from "../io.ts";
import { CliError, ExitCode } from "../errors.ts";
import { runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";
import { BW_TYPE_LABELS, BwItemSchema } from "../../bw/types.ts";
import pc from "picocolors";

const BUILTIN_FIELDS = ["password", "username", "totp", "notes", "uri", "item"];

export function registerGet(program: Command): void {
	program
		.command("get")
		.description("Get a field from a vault item (built-in or custom)")
		.argument("<field>", "Field: password | username | totp | notes | uri | item | <custom>")
		.argument("<item>", "Item name or ID")
		.action(async function (this: Command, field: string, item: string) {
			const opts = getGlobalOpts(this);

			if (BUILTIN_FIELDS.includes(field)) {
				await getBuiltinField(field, item, opts);
			} else {
				await getCustomField(field, item, opts);
			}
		});
}

async function getBuiltinField(
	field: string,
	item: string,
	opts: ReturnType<typeof getGlobalOpts>,
): Promise<void> {
	try {
		const result = await withSession(opts, async () => {
			if (field === "item") {
				return runBwOrThrow(["get", "item", item]);
			}
			return runBwOrThrow(["get", field, item]);
		});

		if (!result) {
			throw new CliError(
				`No ${field} found for item: ${item}`,
				ExitCode.NotFound,
			);
		}

		if (field === "item") {
			emitData(JSON.parse(result), opts);
		} else {
			emitData(result, opts);
		}
	} catch (err) {
		if (
			err instanceof CliError &&
			/more than one result/i.test(err.message)
		) {
			const matches = await resolveAmbiguous(item);
			throw new CliError(
				formatAmbiguousError(item, matches, opts),
				ExitCode.BadArgs,
			);
		}
		throw err;
	}
}

async function getCustomField(
	fieldName: string,
	item: string,
	opts: ReturnType<typeof getGlobalOpts>,
): Promise<void> {
	const json = await withSession(opts, () =>
		runBwOrThrow(["get", "item", item]),
	);

	const parsed = BwItemSchema.parse(JSON.parse(json));
	const fields = parsed.fields ?? [];
	const match = fields.find((f) => f.name === fieldName);

	if (!match) {
		const available = fields.map((f) => f.name).join(", ");
		const msg = available
			? `Field "${fieldName}" not found. Available: ${available}`
			: `Field "${fieldName}" not found (item has no custom fields)`;
		throw new CliError(msg, ExitCode.NotFound);
	}

	emitData(match.value ?? "", opts);
}

interface MatchInfo {
	id: string;
	name: string;
	type: string;
	username?: string;
}

async function resolveAmbiguous(query: string): Promise<MatchInfo[]> {
	try {
		const json = await runBwOrThrow([
			"list",
			"items",
			"--search",
			query,
		]);
		const items: Array<Record<string, unknown>> = JSON.parse(json);
		return items.map((i) => ({
			id: i.id as string,
			name: i.name as string,
			type: BW_TYPE_LABELS[i.type as number] ?? `type:${i.type}`,
			username: (i.login as Record<string, unknown> | null)?.username as
				| string
				| undefined,
		}));
	} catch {
		return [];
	}
}

function formatAmbiguousError(
	query: string,
	matches: MatchInfo[],
	opts: { json?: boolean },
): string {
	if (matches.length === 0) {
		return `Multiple items match "${query}". Use a specific ID instead.`;
	}

	if (opts.json) {
		return `Multiple items match "${query}": ${JSON.stringify(matches)}`;
	}

	const lines = [`Multiple items match "${query}":\n`];
	for (const m of matches) {
		const user = m.username ? ` (${m.username})` : "";
		lines.push(`  ${pc.dim(m.id)}  ${pc.cyan(m.type)}  ${m.name}${pc.dim(user)}`);
	}
	lines.push(`\nUse a specific ID: ${pc.dim("bwx get <field> <id>")}`);
	return lines.join("\n");
}
