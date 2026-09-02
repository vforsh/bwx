---
name: bwx
description: Bitwarden Extended CLI — retrieve, create, edit, delete vault items with auto-unlock. Use when the agent needs passwords, API keys, TOTP codes, card details, custom fields, or vault management. Triggers on mentions of Bitwarden, bw, bwx, vault, password, secrets, TOTP, card number, CVV, save key/token.
---

# bwx

Extended Bitwarden CLI. Wraps `bw` with auto-unlock, session caching, and structured output.

## Quick start

```bash
bwx get password "GitHub"               # retrieve a password (auto-unlocks)
bwx get totp "AWS (user@example.com)"   # TOTP code (+ seconds left, on stderr)
bwx get totp "AWS" --fresh              # wait out a nearly-expired code first
bwx get username "GitHub"               # username
bwx get notes "Deploy key"              # secure note content
bwx get uri "GitHub"                    # first URI
bwx get item "GitHub"                   # full item JSON
bwx get number "Visa"                   # card number (also: cvv, expiry, cardholder, brand)
bwx get "API Key" "Acme"                # custom field by name
bwx field "API Key" "Acme"              # custom-field-only lookup, same arg order
bwx get password "GitHub" --raw         # no trailing newline, for piping into stdin

bwx search github                       # fuzzy search, human table
bwx search github --json                # id/type/name/username only — no secrets
bwx search github --type login --limit 5

# hand a secret to a child process instead of printing it
bwx run --env KEENETIC_PASS=password:'http://my.keenetic.net' -- expect ./recovery.exp

# generate straight into the vault — the value never enters your context
bwx create --type login --name "Deploy" --username svc --password-generate

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
Card items additionally take `number | cvv | cardholder | brand | expiry | expMonth | expYear`.
Anything else is looked up as a custom field. Lists available fields on miss.

A miss suggests near matches; an ambiguous name lists candidates with IDs. Read the
suggestions instead of retrying variations — the answer is usually in them.

### `bwx get totp <item>`

Codes are computed locally from the stored secret, so a TOTP costs no extra `bw` spawn and
batches with other fields from the same item.

```bash
bwx get totp "AWS"                  # code on stdout, "Valid for 17s" on stderr
bwx get totp "AWS" --json           # { "data": "123456", "meta": { "secondsRemaining", "period" } }
bwx get totp "AWS" --fresh          # wait for the next window if under 5s remain
bwx get totp "AWS" --fresh 15       # ...or under 15s
bwx get totp "AWS" --seed           # the stored secret, for migrating to another app
```

**Check `secondsRemaining` before using a code.** A `bw` read plus the time to hand the code
over routinely leaves under 5 seconds, and a code that expires in transit fails the login
with no useful error. `--fresh` sleeps at most one period and returns a full-window code.

Accepts bare base32 and `otpauth://` URIs, honoring their `period`, `digits`, and
`algorithm` (SHA1/SHA256/SHA512). `steam://` secrets and anything else bwx cannot compute
exactly are delegated to `bw get totp` instead of guessed at.

### `bwx field <name> <item>`

Custom fields only, so an item whose custom field is named `password` is still reachable.
Takes its arguments in the same order as `get` (this changed in 0.5.0).

### `--raw` (on `get` and `field`)

Output normally ends in a newline, which a consumer that reads stdin literally takes as
the last byte of the secret. `--raw` suppresses that one newline and nothing else —
newlines inside the value are written through, and the value is byte-for-byte, so
surrounding whitespace survives (the default output trims it).

```bash
bwx get password "GitHub" --raw | argus fill app --selector 'input[type=password]' --value-stdin
```

Prefer this over `$(bwx get …)` when piping a secret: command substitution eats trailing
newlines *and* puts the secret in the child's argv, where any same-user process can read
it. `--raw` and `--json` cannot be combined (the envelope quotes and wraps the value); use
`bwx run --env` when a whole command needs the secret in its environment instead.

### Card fields

```bash
bwx get number "Visa"        # 4111111111111111
bwx get cvv "Visa"           # 123        (bw's own key `code` works too)
bwx get cardholder "Visa"    # Vladislav Forsh
bwx get brand "Visa"         # Visa
bwx get expiry "Visa"        # 03/2030    (composed; withheld if either half is missing)
bwx get expMonth "Visa"      # 03         (zero-padded; bw stores "3")
bwx get expYear "Visa"       # 2030
```

Read from the fetched item — `bw` has no card fields — so they cost one vault read and
batch with each other under `bwx run`. Names match leniently on case, dashes, and
underscores, and bw's JSON keys resolve (`code`, `cardholderName`, `exp-month`).

A card field means the card object **only on a card item**. On any other type it resolves
as a custom field of that name, since `number` and `code` are ordinary field names; the
error names the item's actual type when no such field exists. `bwx field` never returns a
card field.

### `bwx search <query>` / `bwx list [type]`

Flags: `--type login|note|card|identity`, `--folder <name|id>`, `--limit <n>`, `--full-items`

Human, `--plain`, and `--json` output all carry the same reduced projection — `id`, `type`,
`name`, `username`, `hasTotp` — so listings never leak passwords, notes, or custom fields.
`--full-items` opts into complete item objects and **does** include secrets; avoid it in
logged sessions.

`hasTotp` says whether an item has a TOTP secret, never what it is. Use it to find 2FA items
(`bwx list --json --limit 0 | jq '.data[]|select(.hasTotp)'`) instead of reaching for
`--full-items`, which would dump the whole vault in plaintext to answer a boolean.

**Listings stop at 50 items** unless you pass `--limit` (`--limit 0` for all). Truncation is
reported on stderr and in `meta` on the JSON envelope — check it before concluding a listing
was complete. `--limit` rejects non-numeric values rather than ignoring them.

### `bwx folders`

Lists folder names and IDs. `--folder` accepts either on `list`, `search`, `create`, and
`edit`; `none` selects unfiled items.

### `bwx run --env NAME=<field>:<item> -- <command>`

Resolves secrets and injects them into the child's environment only — not stdout, not argv.
This is the preferred way to give a subprocess a credential.

```bash
bwx run --env DB_PASS=password:'Prod DB' -- ./migrate.sh
bwx run --env TOKEN='API Key:Acme' --env USER=username:Acme -- ./deploy.sh
```

- `--env` is repeatable; the field resolves as in `bwx get` (built-in, else card, else custom field).
- Only the first `:` splits field from item, so `password:http://my.router` works.
- Put `--` before the command when it takes its own flags.
- Child stdio is inherited; bwx exits with the child's status (`128 + signal` if killed).
- `-v` logs injected variable names only, never values.
- Several variables from one item cost a single vault read, so group them here rather
  than issuing separate `bwx get` calls.

### `bwx attach list <item>`

Lists attachments for an item. Aliases: `bwx attachment`, `bwx attachments`; `list` has `ls`.

### `bwx attach get <item> <attachment>`

Downloads an attachment by ID or filename. Defaults to saving as the attachment filename in the current directory. Use `--output <path>` to choose a file or directory.

### `bwx create [options]`

Flags: `--type login|note`, `--name`, `--notes`, `--notes-file`, `--username`, `--password`, `--password-stdin`, `--password-file`, `--password-env`, `--password-generate`, `--generate-length <n>`, `--totp`, `--totp-stdin`, `--totp-file`, `--totp-env`, `--uri` (repeatable), `--field k=v` (repeatable), `--field-file k=path`, `--field-env k=ENV`, `--folder <name|id>`, `--favorite`, `--from-json`

`--username`, any `--password-*` or `--totp-*`, and `--uri` require `--type login`; a note
cannot hold them and passing them to one is now an error rather than a silent drop.

Field syntax: `k=v` (text), `!k=v` (hidden), `bool:k=v` (boolean). The same key syntax works for `--field-file` and `--field-env`, where the value is a path or environment variable name. Stdin is read as `--notes` when piped; prefer `--password-stdin` for login passwords.

### `bwx edit <item> [options]`

Fetch → patch → push.
```bash
bwx edit "API Key" --add-field region=us-east-1
printf '%s' "$TOKEN" | bwx edit "GitHub" --password-stdin --uri https://github.com
bwx edit "Note" --rm-field old-key
```
Flags: `--name`, `--notes`, `--notes-file`, `--username`, `--password`, `--password-stdin`, `--password-file`, `--password-env`, `--password-generate`, `--generate-length <n>`, `--totp`, `--totp-stdin`, `--totp-file`, `--totp-env`, `--rm-totp`, `--uri` (replaces all), `--add-field k=v`, `--add-field-file k=path`, `--add-field-env k=ENV`, `--rm-field name`, `--folder <name|id>` (`none` unfiles), `--favorite/--no-favorite`, `--from-json`

### Storing a TOTP secret

```bash
BWX_SEED="JBSWY3DPEHPK3PXP" bwx create --type login --name "AWS" --username me --totp-env BWX_SEED
bwx edit "AWS" --totp "otpauth://totp/AWS:me?secret=JBSWY3DPEHPK3PXP&issuer=AWS"
bwx edit "AWS" --rm-totp
```

Takes a bare base32 secret (spaces, hyphens, and `=` padding are stripped; case is
normalized) or a full `otpauth://` URI, which is stored verbatim so its `period`/`digits`/
`algorithm` survive. Malformed secrets are rejected **before** the write — a bad seed
otherwise sits in the vault until it fails the login it was meant to unlock, which is the
one moment it cannot be fixed.

Prefer `--totp-env` or `--totp-stdin` over `--totp`: a seed on the command line lands in
shell history and `ps` output.

### `bwx delete <item>`

```bash
bwx delete "Test Note" --force      # --force is REQUIRED when not a TTY
bwx delete "Test Note" --permanent --force  # skip the trash
bwx trash                           # what is recoverable
bwx restore "Test Note"             # undo a non-permanent delete
```

The prompt only exists for a human at a terminal, so an agent must pass `--force`
deliberately. Deletes are recoverable through `bwx restore` unless `--permanent`.

### `bwx generate`

```bash
bwx generate --length 32
bwx generate --passphrase --words 5 --separator -
```

Local, no vault access, no unlock. Flags: `--length <n>`, `--no-uppercase`,
`--no-lowercase`, `--no-numbers`, `-s/--special`, `--ambiguous`, `--passphrase`,
`--words <n>`, `--separator <char>`, `--capitalize`, `--include-number`.

Prefer `--password-generate` on `create`/`edit` over generating and passing the value:
it goes to the vault without ever entering your context, and `--json` returns
`***GENERATED***` in place of the password.

### Other

| Command | Description |
|---------|-------------|
| `bwx status` | Vault state + session usability (no auto-unlock) |
| `bwx sync` | Force vault sync |
| `bwx unlock` / `bwx lock` | Manual session control |
| `bwx folders` | Folder names and IDs |
| `bwx trash` / `bwx restore <item>` | Inspect and undo deletes |
| `bwx config list` / `bwx cfg ls` | Show config path + redacted content |
| `bwx config master-password` | Set/update master password in Keychain |

`bwx status` reports `session: valid | stale | none` separately from the vault state.
**A `locked` vault with a `valid` session reads fine — do not run `bwx unlock` on it.**
Only `stale`/`none` mean the next read pays for an unlock.

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
- Prefer `--password-generate` over generating a secret yourself and passing it in.
- Request the narrowest field, resolving an exact item ID first.
- Use `-q` for command substitution so unlock logs cannot contaminate merged output.
- On writes, prefer `--password-stdin`, `--password-env`, `--totp-stdin`, `--totp-env`, `--field-file`, `--field-env`.
- Check `secondsRemaining` on a TOTP, or pass `--fresh`, before handing the code anywhere.
- Use `hasTotp` on a listing to find 2FA items; never `--full-items` for that.
- Never echo, log, checksum, or commit retrieved values; `unset` temporary variables.

## Auth

- Master password: macOS Keychain (account `bitwarden`, service `bitwarden-master`)
- Session cached to `~/.config/bwx/session` (mode 600), given to `bw` via `BW_SESSION`
- Freshness snapshot cached to `~/.config/bwx/state.json`
