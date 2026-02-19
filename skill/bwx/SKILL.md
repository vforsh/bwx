---
name: bwx
description: Bitwarden Extended CLI — retrieve, create, edit, delete vault items with auto-unlock. Use when the agent needs passwords, API keys, TOTP codes, custom fields, or vault management. Triggers on mentions of Bitwarden, bw, bwx, vault, password, secrets, TOTP, save key/token.
---

# bwx

Extended Bitwarden CLI. Wraps `bw` with auto-unlock, session caching, and structured output.

## Quick start

```bash
bwx status                          # vault state (no auto-unlock)
bwx unlock                          # unlock + cache session
bwx get password "GitHub"           # auto-unlocks on first use
```

## Commands

### `bwx get <field> <item>`
Fields: `password | username | totp | notes | uri | item`
```bash
bwx get password "GitHub"
bwx get totp "AWS (vlad@robowhale.com)"
bwx get item "GitHub"               # full JSON
```

### `bwx field <item> <field-name>`
Custom field extraction. Lists available fields on miss.
```bash
bwx field "Acme API Key" "account"
```

### `bwx search <query>`
```bash
bwx search github                   # human table
bwx search github --json            # full JSON
bwx search github --type login --limit 5
```
Flags: `--type login|note|card|identity`, `--folder <id>`, `--limit <n>`

### `bwx create [options]`
```bash
bwx create --name "API Key" --notes "sk_live_abc123" --field account=user@example.com
bwx create --type login --name "GitHub" --username user --password hunter2 --uri https://github.com
echo "secret" | bwx create --name "Piped Note"
```
Flags: `--type login|note`, `--name`, `--notes`, `--username`, `--password`, `--uri` (repeatable), `--field k=v` (repeatable), `--folder`, `--favorite`, `--from-json`

Field syntax: `k=v` (text), `!k=v` (hidden), `bool:k=v` (boolean)

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

### `bwx status`
No auto-unlock. Shows server/email/status/lastSync.

### `bwx sync`
Auto-unlocks, runs `bw sync`.

### `bwx unlock` / `bwx lock`
Manual session control.

### `bwx config master-password`
```bash
bwx config master-password          # interactive prompt
echo "pw" | bwx config master-password  # piped
```

## Global flags

| Flag | Effect |
|------|--------|
| `--json` | `{ "data": ... }` on success, `{ "error": { "message", "exitCode" } }` on failure |
| `--plain` | Stable parseable lines on stdout |
| `-q` | Suppress log output |
| `-v` | Verbose (stack traces on error) |

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

## Auth

- API key login: `BW_CLIENT_ID` + `BW_CLIENT_SECRET` env vars
- Master password: macOS Keychain (account `bitwarden`, service `bitwarden-master`)
- Session cached to `~/.config/bwx/session`
