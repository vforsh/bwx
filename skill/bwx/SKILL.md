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
bwx search github --json                # full JSON array
bwx search github --type login --limit 5

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

### `bwx search <query>`

Flags: `--type login|note|card|identity`, `--folder <id>`, `--limit <n>`

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
| `-q` | Suppress log output |
| `-v` | Verbose (stack traces on error) |

## Auth

- Master password: macOS Keychain (account `bitwarden`, service `bitwarden-master`)
- Session cached to `~/.config/bwx/session`
