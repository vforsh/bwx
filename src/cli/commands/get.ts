import type { Command } from "commander";
import { getGlobalOpts } from "../program.ts";
import { emitData } from "../io.ts";
import { CliError, ExitCode } from "../errors.ts";
import { runBw, runBwOrThrow } from "../../bw/runner.ts";
import { withSession } from "../../bw/session.ts";
import { BW_TYPE_LABELS } from "../../bw/types.ts";
import pc from "picocolors";

const VALID_FIELDS = ["password", "username", "totp", "notes", "uri", "item"];

export function registerGet(program: Command): void {
	program
		.command("get")
		.description("Get a field from a vault item")
		.argument("<field>", `Field: ${VALID_FIELDS.join(" | ")}`)
		.argument("<item>", "Item name or ID")
		.action(async function (this: Command, field: string, item: string) {
			const opts = getGlobalOpts(this);

			if (!VALID_FIELDS.includes(field)) {
				throw new CliError(
					`Invalid field "${field}". Valid: ${VALID_FIELDS.join(", ")}`,
					ExitCode.BadArgs,
				);
			}

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
		});
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
