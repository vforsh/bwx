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
| `bwx status` | Show vault state and whether reads work right now |
| `bwx unlock` | Unlock vault & cache session |
| `bwx lock` | Lock vault & clear session |
| `bwx sync` | Sync vault from server |
| `bwx doctor` | Check setup (bw CLI, email, password, config) |

`status` reports a `session` alongside the vault state, because `bw` answers for the
vault and not for bwx: a `locked` vault with a `valid` session reads fine and needs no
unlock. `valid` means reads work now, `stale` means the cached session was rejected, and
`none` means the next read unlocks.

### Read

| Command | Description |
|---------|-------------|
| `bwx get <field> <item>` | Get field (`password`, `username`, `totp`, `notes`, `uri`, `item`) |
| `bwx get totp <item>` | TOTP code (`--fresh [n]`, `--seed`) |
| `bwx field <name> <item>` | Get custom field by name (same argument order as `get`) |
| `bwx search <query>` | Search items (`--type`, `--folder`, `--limit`, `--full-items`) |
| `bwx list [type]` | List items (`--type`, `--folder`, `--limit`, `--full-items`) |
| `bwx folders` | List folder names and IDs |
| `bwx trash` | List items in the trash |
| `bwx run --env NAME=<field>:<item> -- <cmd>` | Run a command with secrets in its environment |
| `bwx attach list <item>` | List attachments for an item |
| `bwx attach get <item> <attachment>` | Download attachment by ID or filename |

`search` and `list` print the same reduced projection — id, type, name, username,
hasTotp — in human, `--plain`, and `--json` form, so asking for machine-readable output
never widens what is exposed. `--full-items` is the explicit opt-in to complete item
objects, which carry passwords, notes, and custom fields.

`hasTotp` reports that an item has a TOTP secret without carrying it, so finding your 2FA
items does not mean dumping the vault:

```bash
bwx list --json --limit 0 | jq -r '.data[] | select(.hasTotp) | .name'
```

A lookup that finds nothing suggests what you probably meant, and one that matches
several items lists them, so neither ends in a guessing round:

```
$ bwx get password "GitHub PAT vforsh old"
error: No item matching "GitHub PAT vforsh old". Did you mean:

  934c1f57-…  note  GitHub PAT (vforsh)
  3683fb9a-…  note  GitHub PAT (yaforsh) [codex-monitor-pr]
```

### TOTP

Codes are computed locally from the stored secret. A TOTP therefore costs no extra `bw`
spawn and batches with the other fields of the same item, and bwx can report how long the
code has left.

```bash
bwx get totp "AWS"              # code on stdout, "Valid for 17s" on stderr
bwx get totp "AWS" --json       # { "data": "123456", "meta": { "secondsRemaining": 17, "period": 30 } }
bwx get totp "AWS" --fresh      # wait for the next window if under 5s remain
bwx get totp "AWS" --fresh 15   # ...or under 15s
bwx get totp "AWS" --seed       # the stored secret, for moving it to another authenticator
```

The remainder matters more than it looks: a vault read plus the time to actually use the
code often leaves single-digit seconds, and a code that expires in transit fails the login
without saying why. `--fresh` sleeps at most one period and hands back a full window.

Bare base32 and `otpauth://` URIs are both understood, including non-default `period`,
`digits`, and `algorithm` (SHA1/SHA256/SHA512). Secrets bwx will not compute exactly —
`steam://`, unknown algorithms, anything that fails to decode — fall back to `bw get totp`
rather than being guessed at, since a wrong code is indistinguishable from a right one
until the login fails.

Storing a secret:

```bash
BWX_SEED="JBSWY3DPEHPK3PXP" bwx create --type login --name "AWS" --username me --totp-env BWX_SEED
bwx edit "AWS" --totp "otpauth://totp/AWS:me?secret=JBSWY3DPEHPK3PXP&issuer=AWS"
bwx edit "AWS" --rm-totp
```

Spaces, hyphens, and `=` padding are stripped and case is normalized; an `otpauth://` URI
is stored verbatim so its parameters survive. Malformed secrets are rejected before the
write, because a bad seed is otherwise discovered at the login it was supposed to unlock.

### Listings are capped

Listings stop at 50 items by default — an uncapped `bwx list` returns the whole vault,
and with `--full-items` that is every secret in one call. `--limit 0` opts out. Truncation
is never silent: it warns on stderr (surviving `--json`) and adds `meta` to the JSON
envelope.

```bash
bwx list --limit 0            # everything
bwx list --json               # { "data": [...], "meta": { "total": 491, "shown": 50, "truncated": true } }
```

### Folders

`--folder` takes a name or an ID on `list`, `search`, `create`, and `edit`; `none` means
the unfiled bucket. Names are resolved against the vault, so `bwx folders` is only needed
to see what exists.

```bash
bwx folders
bwx list --folder "API Keys"
bwx edit "Acme" --folder none     # unfile
```

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
| `bwx create` | Create item (`--type`, `--name`, `--username`, `--password-stdin`, `--totp-env`, `--field-file k=path`) |
| `bwx edit <item>` | Edit item (`--name`, `--password-env`, `--totp`, `--rm-totp`, `--add-field-file k=path`, `--rm-field name`) |
| `bwx delete <item>` | Delete item (`--permanent`, `--force`) |
| `bwx restore <item>` | Restore an item from the trash |
| `bwx generate` | Generate a password or passphrase (local, no vault access) |

Login-only flags (`--username`, any `--password-*` or `--totp-*`, `--uri`) require a login
item. A secure note has nowhere to put them, so passing them to one is an error rather
than an exit 0 over a credential that was silently dropped.

`bwx delete` requires `--force` whenever it is not talking to a terminal. The confirmation
prompt cannot render for a script or an agent, so without it `--force` would be decorative
and every non-interactive delete unguarded. Deletes go to the trash unless `--permanent`,
and `bwx trash` / `bwx restore` are the way back.

### Generated passwords

`--password-generate` on `create` and `edit` sends a new secret straight to the vault. It
is never printed, never echoed back in `--json`, and never reaches a terminal, a
transcript, or a log — which is what makes it safe to use from an agent.

```bash
bwx create --type login --name "Deploy" --username svc --password-generate
bwx edit "Deploy" --password-generate --generate-length 32
bwx generate --length 32                  # print one instead
bwx generate --passphrase --words 5
```

`bwx generate` runs locally and needs no unlocked vault. Flags: `--length <n>`,
`--no-uppercase`, `--no-lowercase`, `--no-numbers`, `-s/--special`, `--ambiguous`,
`--passphrase`, `--words <n>`, `--separator <char>`, `--capitalize`, `--include-number`.

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
- TOTP secrets: `--totp-stdin`, `--totp-file <path>`, `--totp-env <name>`
- Notes: `--notes-file <path>`
- Create fields: `--field-file k=path`, `--field-env k=ENV`
- Edit fields: `--add-field-file k=path`, `--add-field-env k=ENV`
- Use `-` as the file path to read that source from stdin.

### Global flags

| Flag | Effect |
|------|--------|
| `--json` | JSON output: `{ "data": ... }` / `{ "error": ... }`, plus `meta` where a response describes itself |
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

## Upgrading to 0.5.0

Breaking changes, all of them cases where the old behavior failed quietly:

- `bwx field` takes `<name> <item>`, matching `bwx get`. It was `<item> <name>`.
- `bwx delete` needs `--force` when not interactive; it used to delete unprompted.
- `bwx list` and `bwx search` stop at 50 items unless given `--limit`. Pass `--limit 0`
  for the old behavior.
- `--limit` rejects non-numeric values instead of ignoring them (and returning everything).
- Login-only flags on a secure note are an error instead of a silent drop.

## Stack

Bun, TypeScript, Commander, Zod, picocolors.
