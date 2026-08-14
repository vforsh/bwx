// All bwx state lives in one XDG-respecting directory so config, session, and
// freshness state can never drift apart.

const CONFIG_HOME =
	process.env.XDG_CONFIG_HOME ?? `${process.env.HOME}/.config`;

export const CONFIG_DIR = `${CONFIG_HOME}/bwx`;
export const CONFIG_FILE = `${CONFIG_DIR}/config.json`;
/** Cached `bw` session token (owner-only). */
export const SESSION_FILE = `${CONFIG_DIR}/session`;
/** Cached vault-freshness snapshot — see bw/freshness.ts. */
export const STATE_FILE = `${CONFIG_DIR}/state.json`;
