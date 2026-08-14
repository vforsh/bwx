export interface GlobalOptions {
	json?: boolean;
	plain?: boolean;
	quiet?: boolean;
	verbose?: boolean;
	/** Deadline for each `bw` call in ms; `0` disables it. */
	timeoutMs?: number;
	/**
	 * Sync before vault access when the last sync is older than this, in ms.
	 * Undefined means "only warn about a stale vault".
	 */
	syncIfOlderThanMs?: number;
}
