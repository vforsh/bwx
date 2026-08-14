---
name: bwx
description: Bitwarden Extended CLI — retrieve, create, edit, delete vault items with auto-unlock. Use when the agent needs passwords, API keys, TOTP codes, custom fields, or vault management. Triggers on mentions of Bitwarden, bw, bwx, vault, password, secrets, TOTP, save key/token.
---

# bwx

Extended Bitwarden CLI. Wraps `bw` with auto-unlock, session caching, and structured output.

## Quick start

```bash
bwx get password "GitHub"               # retrieve a password (auto-unlocks)
bwx get totp "AWS (user@example.com)"   # TOTP code
bwx get username "GitHub"               # username
bwx get notes "Deploy key"              # secure note content
bwx get uri "GitHub"                    # first URI
bwx get item "GitHub"                   # full item JSON
bwx get "API Key" "Acme"                # custom field by name
bwx field "Acme" "API Key"              # custom field alias

bwx search github                       # fuzzy search, human table
bwx search github --json                # id/type/name/username only — no secrets
bwx search github --type login --limit 5

# hand a secret to a child process instead of printing it
bwx run --env KEENETIC_PASS=password:'http://my.keenetic.net' -- expect ./recovery.exp

bwx attach list "Apple Developer"       # list item attachments
bwx attach get "Apple Developer" AuthKey.p8
bwx attach get "Apple Developer" AuthKey.p8 --output ./secrets/

bwx create --name "API Key" --notes "sk_live_abc123" --field account=acme
printf '%s' "$TOKEN" | bwx create --type login --name "GitHub" --username user --password-stdin --uri https://github.com
bwx create --name "Acme" --field-file '!API Key=./token.txt' --field-env account=ACME_ACCOUNT
echo "secret" | bwx create --name "Piped Note"
```

## Commands

### `bwx get <field> <item>`

Built-in fields: `password | username | totp | notes | uri | item`.
Anything else is looked up as a custom field. Lists available fields on miss.

### `bwx field <item> <name>`

Alias for retrieving custom fields with item-first argument order.

### `bwx search <query>` / `bwx list [type]`

Flags: `--type login|note|card|identity` (`search`), `--folder <id>`, `--limit <n>`, `--full-items`

Human, `--plain`, and `--json` output all carry the same reduced projection — `id`, `type`,
`name`, `username` — so listings never leak passwords, notes, or custom fields. `--full-items`
opts into complete item objects and **does** include secrets; avoid it in logged sessions.

### `bwx run --env NAME=<field>:<item> -- <command>`

Resolves secrets and injects them into the child's environment only — not stdout, not argv.
This is the preferred way to give a subprocess a credential.

```bash
bwx run --env DB_PASS=password:'Prod DB' -- ./migrate.sh
bwx run --env TOKEN='API Key:Acme' --env USER=username:Acme -- ./deploy.sh
```

- `--env` is repeatable; the field resolves as in `bwx get` (built-in, else custom field).
- Only the first `:` splits field from item, so `password:http://my.router` works.
- Put `--` before the command when it takes its own flags.
- Child stdio is inherited; bwx exits with the child's status (`128 + signal` if killed).
- `-v` logs injected variable names only, never values.

### `bwx attach list <item>`

Lists attachments for an item. Aliases: `bwx attachment`, `bwx attachments`; `list` has `ls`.

### `bwx attach get <item> <attachment>`

Downloads an attachment by ID or filename. Defaults to saving as the attachment filename in the current directory. Use `--output <path>` to choose a file or directory.

### `bwx create [options]`

Flags: `--type login|note`, `--name`, `--notes`, `--notes-file`, `--username`, `--password`, `--password-stdin`, `--password-file`, `--password-env`, `--uri` (repeatable), `--field k=v` (repeatable), `--field-file k=path`, `--field-env k=ENV`, `--folder`, `--favorite`, `--from-json`

Field syntax: `k=v` (text), `!k=v` (hidden), `bool:k=v` (boolean). The same key syntax works for `--field-file` and `--field-env`, where the value is a path or environment variable name. Stdin is read as `--notes` when piped; prefer `--password-stdin` for login passwords.

### `bwx edit <item> [options]`

Fetch → patch → push.
```bash
bwx edit "API Key" --add-field region=us-east-1
printf '%s' "$TOKEN" | bwx edit "GitHub" --password-stdin --uri https://github.com
bwx edit "Note" --rm-field old-key
```
Flags: `--name`, `--notes`, `--notes-file`, `--username`, `--password`, `--password-stdin`, `--password-file`, `--password-env`, `--uri` (replaces all), `--add-field k=v`, `--add-field-file k=path`, `--add-field-env k=ENV`, `--rm-field name`, `--folder`, `--favorite/--no-favorite`, `--from-json`

### `bwx delete <item>`

```bash
bwx delete "Test Note"              # prompts in TTY
bwx delete "Test Note" --force      # skip prompt
bwx delete "Test Note" --permanent  # no trash
```

### Other

| Command | Description |
|---------|-------------|
| `bwx status` | Vault state (no auto-unlock) |
| `bwx sync` | Force vault sync |
| `bwx unlock` / `bwx lock` | Manual session control |
| `bwx config list` / `bwx cfg ls` | Show config path + redacted content |
| `bwx config master-password` | Set/update master password in Keychain |

## Global flags

| Flag | Effect |
|------|--------|
| `--json` | `{ "data": ... }` on success, `{ "error": { "message", "exitCode" } }` on failure |
| `--plain` | Stable parseable lines on stdout |
| `-q` | Suppress logs and warnings |
| `-v` | Verbose (stack traces on error) |
| `--timeout <duration>` | Deadline per `bw` call (default `1m`, `0` disables) → exit 8 |
| `--sync-if-older-than <duration>` | Sync first when the vault last synced longer ago |

Durations: `250ms`, `30s`, `15m`, `2h`, `1d`; a bare number is seconds.

## Vault freshness

Reads come from the local vault copy. Reads warn on stderr when the last sync is over 24h
old — a rotated secret can otherwise look valid or missing. Pass
`--sync-if-older-than 15m` to sync first instead, or run `bwx sync`. Warnings reach stderr
even under `--json`; `-q` silences them.

## Safety rules

- Never use `--full-items` (or `get item` for discovery) in logged sessions.
- Prefer `bwx run --env ...` over `export VAR="$(bwx get ...)"`; secrets never touch stdout or argv.
- Request the narrowest field, resolving an exact item ID first.
- Use `-q` for command substitution so unlock logs cannot contaminate merged output.
- On writes, prefer `--password-stdin`, `--password-env`, `--field-file`, `--field-env`.
- Never echo, log, checksum, or commit retrieved values; `unset` temporary variables.

## Auth

- Master password: macOS Keychain (account `bitwarden`, service `bitwarden-master`)
- Session cached to `~/.config/bwx/session` (mode 600), given to `bw` via `BW_SESSION`
- Freshness snapshot cached to `~/.config/bwx/state.json`
