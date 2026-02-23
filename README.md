# bwx

Bitwarden CLI wrapper for AI agents (`bwx` = `bw extended`). Auto-unlock, session caching, structured output.

> Currently macOS-only: `bwx` uses macOS Keychain for secure master password storage.

## Platform support

- ✅ macOS
- ❌ Linux (not supported yet)
- ❌ Windows (not supported yet)

`bwx` relies on macOS Keychain for secure master-password storage and retrieval.

## Why

The native `bw` CLI requires interactive prompts and manual session management. `bwx` wraps it with:

- **Auto-unlock** — first vault command authenticates automatically via macOS Keychain
- **Session caching** — token persisted to `~/.config/bwx/session` (mode 600), reused across calls
- **Structured output** — `--json` and `--plain` flags for machine-parseable output
- **No interaction** — credentials from config + Keychain, never prompts

## Install

```bash
# Global install
bun install -g bwx

# Or run without installing
bunx bwx doctor
```

Requires [Bitwarden CLI](https://bitwarden.com/help/cli/) (`bw`) installed and on PATH.

## Setup

```bash
# Store your Bitwarden account email
bwx config email your@email.com

# Store master password in macOS Keychain
bwx config master-password

# Verify everything is ready
bwx doctor
```

## Commands

### Vault

| Command | Description |
|---------|-------------|
| `bwx status` | Show vault state |
| `bwx unlock` | Unlock vault & cache session |
| `bwx lock` | Lock vault & clear session |
| `bwx sync` | Sync vault from server |
| `bwx doctor` | Check setup (bw CLI, email, password, config) |

### Read

| Command | Description |
|---------|-------------|
| `bwx get <field> <item>` | Get field (`password`, `username`, `totp`, `notes`, `uri`, `item`) |
| `bwx field <item> <name>` | Get custom field by name |
| `bwx search <query>` | Search items (`--type`, `--folder`, `--limit`) |

### Write

| Command | Description |
|---------|-------------|
| `bwx create` | Create item (`--type`, `--name`, `--username`, `--password`, `--uri`, `--field k=v`) |
| `bwx edit <item>` | Edit item (`--name`, `--password`, `--add-field k=v`, `--rm-field name`) |
| `bwx delete <item>` | Delete item (`--permanent`, `--force`) |

### Config

| Command | Description |
|---------|-------------|
| `bwx config email [addr]` | Set account email |
| `bwx config master-password` | Store master password in Keychain |
| `bwx config list` / `bwx cfg ls` | Show config path + redacted content |

### Global flags

| Flag | Effect |
|------|--------|
| `--json` | JSON output: `{ "data": ... }` / `{ "error": ... }` |
| `--plain` | Tab-separated, one item per line |
| `-q, --quiet` | Suppress logs |
| `-v, --verbose` | Include stack traces |

## Custom fields

Field syntax for `--field` / `--add-field`:

- `key=value` — text field
- `!key=value` — hidden field
- `bool:key=value` — boolean field

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | OK |
| 1 | Unknown error |
| 2 | Bad arguments |
| 3 | Auth failed |
| 4 | Not found |
| 5 | bw error |
| 6 | Network error |
| 7 | Config error |
| 8 | Timeout |
| 9 | User cancelled |

## Stack

Bun, TypeScript, Commander, Zod, picocolors.
