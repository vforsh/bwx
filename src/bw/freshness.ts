import { formatDuration } from "../cli/duration.ts";
import { emitLog, emitWarn } from "../cli/io.ts";
import type { GlobalOptions } from "../cli/types.ts";
import { STATE_FILE } from "../config/paths.ts";
import { readPrivateFile, writePrivateFile } from "../config/secure-file.ts";
import { getStatus } from "./status.ts";
import type { BwStatus } from "./types.ts";

/**
 * `bw` serves reads from the local vault copy, so a vault that has not synced in
 * days silently returns rotated-away secrets. Reads therefore check freshness —
 * but `bw status` costs a full `bw` spawn (~2s), far too much to pay on every
 * read, so the answer is cached here and only re-polled when it might matter.
 */

/** Warn when the vault has not synced within this window. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1_000;

/** While the vault looks stale, ask `bw status` again at most this often. */
const RECHECK_INTERVAL_MS = 5 * 60 * 1_000;

export interface FreshnessSnapshot {
	/** `lastSync` as reported by `bw status`; null when the vault never synced. */
	lastSync: string | null;
	/** When bwx last asked `bw status` for that value. */
	checkedAt: string;
}

export type FreshnessPlan =
	/** Known fresh — no `bw` call, no warning. */
	| "skip"
	/** Known stale recently enough to trust the cached answer. */
	| "stale"
	/** Cached answer is missing, unusable, or too old to trust. */
	| "poll";

/**
 * Decides what can be concluded from the cached snapshot alone. Pure so the
 * caching policy stays testable without a vault.
 */
export function planFreshnessCheck(
	snapshot: FreshnessSnapshot | null,
	thresholdMs: number,
	now: number,
): FreshnessPlan {
	if (!snapshot) return "poll";

	if (isFresh(snapshot, thresholdMs, now)) return "skip";

	const checkedAgeMs = now - Date.parse(snapshot.checkedAt);
	const checkedRecently =
		Number.isFinite(checkedAgeMs) &&
		checkedAgeMs >= 0 &&
		checkedAgeMs < RECHECK_INTERVAL_MS;

	// lastSync only ever moves forward, so a stale reading stays stale unless
	// another client synced — worth re-checking, just not on every read.
	return checkedRecently ? "stale" : "poll";
}

/**
 * Warns (or syncs, with `--sync-if-older-than`) when the local vault is stale.
 * Advisory only: any failure to determine freshness is ignored rather than
 * failing the operation the caller actually asked for.
 */
export async function checkVaultFreshness(
	opts: GlobalOptions,
	sync: () => Promise<unknown>,
): Promise<void> {
	const syncOnStale = opts.syncIfOlderThanMs !== undefined;
	const thresholdMs = opts.syncIfOlderThanMs ?? STALE_AFTER_MS;

	let snapshot = loadSnapshot();
	const plan = planFreshnessCheck(snapshot, thresholdMs, Date.now());
	if (plan === "skip") return;

	if (plan === "poll") {
		try {
			snapshot = recordStatus(await getStatus());
		} catch {
			return; // Freshness is advisory — never block the real operation.
		}
		if (isFresh(snapshot, thresholdMs, Date.now())) return;
	}

	const ageMs = snapshotAgeMs(snapshot, Date.now());
	const age = ageMs === null ? "never" : `${formatDuration(ageMs)} ago`;

	if (!syncOnStale) {
		emitWarn(
			`Vault last synced ${age} — reads may be stale. Run 'bwx sync' or pass --sync-if-older-than <duration>.`,
			opts,
		);
		return;
	}

	emitLog(`Vault last synced ${age} — syncing...`, opts);
	await sync();
	recordSyncNow();
}

/** Caches what `bw status` just reported. */
export function recordStatus(status: BwStatus): FreshnessSnapshot {
	return saveSnapshot({
		lastSync: status.lastSync,
		checkedAt: new Date().toISOString(),
	});
}

/**
 * Records a sync that just completed. The stored `lastSync` is our own clock
 * rather than the server's, which is close enough to keep later reads quiet.
 */
export function recordSyncNow(): void {
	const now = new Date().toISOString();
	saveSnapshot({ lastSync: now, checkedAt: now });
}

function isFresh(
	snapshot: FreshnessSnapshot | null,
	thresholdMs: number,
	now: number,
): boolean {
	const ageMs = snapshotAgeMs(snapshot, now);
	return ageMs !== null && ageMs < thresholdMs;
}

function snapshotAgeMs(
	snapshot: FreshnessSnapshot | null,
	now: number,
): number | null {
	if (!snapshot?.lastSync) return null;
	const syncedAt = Date.parse(snapshot.lastSync);
	if (!Number.isFinite(syncedAt)) return null;
	return Math.max(0, now - syncedAt);
}

function loadSnapshot(): FreshnessSnapshot | null {
	const read = readPrivateFile(STATE_FILE);
	if (read.kind !== "ok") return null;

	try {
		const parsed = JSON.parse(read.text) as Partial<FreshnessSnapshot>;
		if (typeof parsed.checkedAt !== "string") return null;
		return {
			lastSync: typeof parsed.lastSync === "string" ? parsed.lastSync : null,
			checkedAt: parsed.checkedAt,
		};
	} catch {
		return null;
	}
}

function saveSnapshot(snapshot: FreshnessSnapshot): FreshnessSnapshot {
	try {
		writePrivateFile(STATE_FILE, JSON.stringify(snapshot) + "\n");
	} catch {
		// A read-only config dir must not break vault access.
	}
	return snapshot;
}
