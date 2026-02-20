---
name: bwx
description: Bitwarden Extended CLI — retrieve, create, edit, delete vault items with auto-unlock. Use when the agent needs passwords, API keys, TOTP codes, custom fields, or vault management. Triggers on mentions of Bitwarden, bw, bwx, vault, password, secrets, TOTP, save key/token.
---

# bwx

Extended Bitwarden CLI. Wraps `bw` with auto-unlock, session caching, and structured output.

## Quick start

```bash
bwx get password "GitHub"               # retrieve a password (auto-unlocks)
bwx get totp "AWS (vlad@robowhale.com)" # TOTP code
bwx get username "GitHub"               # username
bwx get notes "Deploy key"              # secure note content
bwx get uri "GitHub"                    # first URI
bwx get item "GitHub"                   # full item JSON
bwx get "API Key" "Acme"                # custom field by name

bwx search github                       # fuzzy search, human table
bwx search github --json                # full JSON array
bwx search github --type login --limit 5

bwx create --name "API Key" --notes "sk_live_abc123" --field account=acme
bwx create --type login --name "GitHub" --username user --password hunter2 --uri https://github.com
echo "secret" | bwx create --name "Piped Note"
```

## Commands

### `bwx get <field> <item>`

Built-in fields: `password | username | totp | notes | uri | item`.
Anything else is looked up as a custom field. Lists available fields on miss.

### `bwx search <query>`

Flags: `--type login|note|card|identity`, `--folder <id>`, `--limit <n>`

### `bwx create [options]`

Flags: `--type login|note`, `--name`, `--notes`, `--username`, `--password`, `--uri` (repeatable), `--field k=v` (repeatable), `--folder`, `--favorite`, `--from-json`

Field syntax: `k=v` (text), `!k=v` (hidden), `bool:k=v` (boolean). Stdin is read as `--notes` when piped.

### `bwx edit <item> [options]`

Fetch → patch → push.
```bash
bwx edit "API Key" --add-field region=us-east-1
bwx edit "GitHub" --password newpass --uri https://github.com
bwx edit "Note" --rm-field old-key
```
Flags: `--name`, `--notes`, `--username`, `--password`, `--uri` (replaces all), `--add-field k=v`, `--rm-field name`, `--folder`, `--favorite/--no-favorite`, `--from-json`

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
