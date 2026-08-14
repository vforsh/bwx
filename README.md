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
- **Session caching** — token written atomically as mode 600 to `~/.config/bwx/session`, passed to `bw` through `BW_SESSION` so it never appears in a process command line
- **Structured output** — `--json` and `--plain` flags for machine-parseable output
- **Leak-resistant** — listings never print secrets, `bwx run` hands them to a child process instead of stdout
- **No interaction** — credentials from config + Keychain, never prompts
- **Bounded** — every `bw` call has a deadline, so a wedged vault operation cannot hang a caller

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
| `bwx search <query>` | Search items (`--type`, `--folder`, `--limit`, `--full-items`) |
| `bwx list [type]` | List items (`--folder`, `--limit`, `--full-items`) |
| `bwx run --env NAME=<field>:<item> -- <cmd>` | Run a command with secrets in its environment |
| `bwx attach list <item>` | List attachments for an item |
| `bwx attach get <item> <attachment>` | Download attachment by ID or filename |

`search` and `list` print the same reduced projection — id, type, name, username — in
human, `--plain`, and `--json` form, so asking for machine-readable output never widens
what is exposed. `--full-items` is the explicit opt-in to complete item objects, which
carry passwords, notes, and custom fields.

### Secrets into a child process

`bwx run` resolves secrets and places them only in the child's environment: nothing is
printed to stdout, and nothing lands in a command line where other processes could read it.

```bash
bwx run --env KEENETIC_PASS=password:'http://my.keenetic.net' -- expect ./recovery.exp
bwx run --env DB_PASS=password:'Prod DB' --env TOKEN='API Key:Acme' -- ./deploy.sh
```

- `--env NAME=<field>:<item>` is repeatable; the field resolves exactly as in `bwx get`
  (built-ins first, otherwise a custom field name).
- The item may contain colons — only the first one separates field from item.
- Use `--` before the command whenever it takes its own flags.
- The child inherits stdio and bwx exits with the child's status (`128 + signal` when killed).
- `-v` logs the injected variable *names*; values are never logged.

### Vault freshness

`bw` answers reads from the local vault copy, so a vault that has not synced in a while
returns stale secrets. Reads warn on stderr when the last sync is over 24h old, and
`--sync-if-older-than <duration>` syncs first instead of warning:

```bash
bwx get password "Router"                          # warns if the vault is stale
bwx --sync-if-older-than 15m get password "Router" # syncs first when needed
```

The check is cached in `~/.config/bwx/state.json`, so a fresh vault costs no extra `bw` call.

### Write

| Command | Description |
|---------|-------------|
| `bwx create` | Create item (`--type`, `--name`, `--username`, `--password-stdin`, `--field-file k=path`) |
| `bwx edit <item>` | Edit item (`--name`, `--password-env`, `--add-field-file k=path`, `--rm-field name`) |
| `bwx delete <item>` | Delete item (`--permanent`, `--force`) |

### Config

| Command | Description |
|---------|-------------|
| `bwx config email [addr]` | Set account email |
| `bwx config master-password` | Store master password in Keychain |
| `bwx config list` / `bwx cfg ls` | Show config path + redacted content |

### Attachments

```bash
bwx attach list "Apple Developer"
bwx attach get "Apple Developer" "AuthKey.p8"
bwx attach get "Apple Developer" "AuthKey.p8" --output ./secrets/
```

Aliases: `attach`, `attachment`, `attachments`; `list` also has `ls`.

### Safe input

Prefer stdin, files, or environment variables for secrets so values do not land in shell history.

```bash
printf '%s' "$TOKEN" | bwx create --type login --name "GitHub" --username user --password-stdin
bwx edit "GitHub" --password-env GITHUB_TOKEN
bwx create --name "Deploy key" --notes-file ./deploy-key.txt
bwx create --name "Acme" --field-file '!API Key=./token.txt' --field-env account=ACME_ACCOUNT
```

Supported source flags:

- Passwords: `--password-stdin`, `--password-file <path>`, `--password-env <name>`
- Notes: `--notes-file <path>`
- Create fields: `--field-file k=path`, `--field-env k=ENV`
- Edit fields: `--add-field-file k=path`, `--add-field-env k=ENV`
- Use `-` as the file path to read that source from stdin.

### Global flags

| Flag | Effect |
|------|--------|
| `--json` | JSON output: `{ "data": ... }` / `{ "error": ... }` |
| `--plain` | Tab-separated, one item per line |
| `-q, --quiet` | Suppress logs and warnings |
| `-v, --verbose` | Include stack traces |
| `--timeout <duration>` | Deadline for each `bw` call (default `1m`, `0` disables) |
| `--sync-if-older-than <duration>` | Sync before vault access when the last sync is older |

Durations accept `250ms`, `30s`, `15m`, `2h`, `1d`; a bare number means seconds.

Warnings ("vault is stale", "ignoring cached session") go to stderr even under `--json`,
because they say the returned data may be wrong. `-q` silences them.

## Custom fields

Field syntax for `--field`, `--field-file`, `--field-env`, and edit variants:

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
