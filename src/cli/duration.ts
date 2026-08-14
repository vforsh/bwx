import { CliError, ExitCode } from "./errors.ts";

const UNIT_MS: Record<string, number> = {
	ms: 1,
	s: 1_000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
};

const DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/;

/** Parses `250ms`, `30s`, `15m`, `2h`, `1d`. A bare number is seconds. */
export function parseDuration(raw: string, flag: string): number {
	const match = DURATION_RE.exec(raw.trim());
	if (!match) {
		throw new CliError(
			`Invalid duration "${raw}" for ${flag}. Use e.g. 30s, 15m, 2h`,
			ExitCode.BadArgs,
		);
	}
	return Math.round(Number(match[1]) * UNIT_MS[match[2] ?? "s"]!);
}

/** Coarse human-readable duration for diagnostics: `45s`, `12m`, `3h`, `8d`. */
export function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${hours}h`;
	return `${Math.round(hours / 24)}d`;
}
