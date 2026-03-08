# Keyflare — CLI Reference (`kfl`)

## Overview

`kfl` is the command-line interface for Keyflare. It communicates with the Keyflare Worker API over HTTPS.

## Global Options

```
--api-url <url>       Override the API URL (default: from config)
--api-key <key>       Override the API key (default: from credentials file or $KEYFLARE_API_KEY)
--project <name>      Override the default project
--config <name>       Specify the environment/config name
--help                Show help
--version             Show version
```

## Commands

### `kfl init`

Deploy (or redeploy) Keyflare to your Cloudflare account in an idempotent way.

```bash
kfl init [--force] [--masterkey <key>]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--force` | Reserved for compatibility (currently no-op) |
| `--masterkey <key>` | Custom master key (base64-encoded 256-bit). See [Master Key Format](#master-key-format) below. |

**Authentication behavior**:

| Method | How |
|--------|-----|
| **Browser (OAuth)** | Reuses an existing Wrangler session when available (detected via `npx wrangler whoami --json`). If not logged in, can open `cloudflare.com` via `wrangler login`. |
| **API Token** | Paste a token at the prompt, or pre-set `CLOUDFLARE_API_TOKEN` to skip the prompt (CI-friendly). |

If Wrangler is already logged in, `kfl init` skips auth prompts and uses that session automatically.

If `CLOUDFLARE_API_TOKEN` is already set in the environment, it is used silently without prompting.

#### Master Key Format

The master key is a **base64-encoded 256-bit (32-byte) key**. It must:

- Be exactly 44 characters when base64-encoded
- Decode to exactly 32 bytes
- Use standard base64 encoding (A-Z, a-z, 0-9, +, /)

**Example valid key:**
```
K7gNU3sdo+OL0wNhqoVWhr3g6s1xYv72ol/pe/Unols=
```

**Generate your own:**
```bash
# Using openssl
openssl rand -base64 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> **Important:** `kfl init` never overrides an existing `MASTER_KEY` secret. If the secret already exists, `--masterkey` is ignored to prevent data loss.

#### Deploy Flow (first run and re-runs)

`kfl init` always runs the same flow:

1. Checks current Wrangler auth via `npx wrangler whoami --json`
2. If logged in, reuses that session (no auth prompt)
3. If not logged in, uses `CLOUDFLARE_API_TOKEN` when present, otherwise prompts for OAuth browser login or API token
4. Verifies credentials (`wrangler whoami`)
5. Deploys the Worker via `wrangler deploy` (Wrangler auto-provisions D1 from `wrangler.jsonc`)
6. Checks whether `MASTER_KEY` already exists on the worker
7. If missing, generates 256-bit `MASTER_KEY` (or uses `--masterkey`) and stores it via `wrangler secret put`
8. Applies Drizzle migrations (`wrangler d1 migrations apply DB_BINDING --remote`)
9. Calls `POST /bootstrap` (idempotent: conflict means already initialized)
10. Saves API URL (and root key when newly created) to `~/.config/keyflare/`

```
$ kfl init

🔥 Keyflare — Initial Setup

? How would you like to authenticate with Cloudflare?
❯ Browser (OAuth) — opens cloudflare.com in your browser
  API Token — paste a Cloudflare API token

✓ Authenticated as: my-account
✓ Worker deployed: https://keyflare.my-account.workers.dev
✓ No MASTER_KEY secret found

⚠ MASTER KEY — Save this somewhere safe. It cannot be recovered!

  K7gNU3sdo+OL0wNhqoVWhr3g6s1xYv72ol/pe/Unols=

? I have saved the master key  Yes

✓ Worker deployed: https://keyflare.my-account.workers.dev
✓ Master key stored as Worker secret
✓ Database migrations applied
✓ Root API key created

✓ Keyflare deployed successfully!

Your root API key (shown once — already saved to ~/.config/keyflare/):

  kfl_user_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6

⚠️  IMPORTANT: Your master key (save this securely!)

  K7gNU3sdo+OL0wNhqoVWhr3g6s1xYv72ol/pe/Unols=

This key is shown ONCE. Store it safely — if lost, all encrypted data
in D1 becomes permanently unrecoverable. If compromised, re-encrypt
everything with a new key.

API URL: https://keyflare.my-account.workers.dev
Config:  ~/.config/keyflare/
```

#### Using a Custom Master Key

Bring your own master key for compliance or backup purposes:

```bash
# Generate and store the key in your password manager first
$ MY_KEY=$(openssl rand -base64 32)

# Use during init
$ kfl init --masterkey "$MY_KEY"

🔥 Keyflare — Initial Setup

Using custom master key provided via --masterkey flag

? How would you like to authenticate with Cloudflare? ...
```

If `MASTER_KEY` already exists on the worker, the provided key is ignored and the existing key remains unchanged.

---

### `kfl login`

Log in to an existing Keyflare deployment. Use this when the service is already deployed and you need to configure your local CLI with the API URL and an API key.

```bash
kfl login
```

Interactive flow:
1. Prompts for the Keyflare API URL (e.g., `https://keyflare.your-account.workers.dev`)
2. Prompts for your API key (hidden input)
3. Verifies credentials by calling the API
4. Saves both to `~/.config/keyflare/`

```
$ kfl login

🔑 Keyflare Login

? Keyflare API URL: https://keyflare.my-account.workers.dev
? API Key: ********
✓ Credentials verified

✓ Logged in!

API URL: https://keyflare.my-account.workers.dev
Credentials saved to: ~/.config/keyflare/
```

This is useful when:
- Setting up a new machine
- Switching between different Keyflare deployments
- After a colleague shares an API key with you
- Recovering access after deleting local config

---

### `kfl projects`

Manage projects.

```bash
# List all projects
kfl projects list

# Create a new project (creates Dev and Prod environments by default)
kfl projects create <name>

# Create a project without default environments
kfl projects create <name> --environmentless

# Delete a project (and all its environments/secrets)
kfl projects delete <name>
```

**Options for `create`:**

| Flag | Description |
|------|-------------|
| `--environmentless` | Create the project without default Dev/Prod environments. You can add configs later with `kfl configs create`. |

**Examples:**
```bash
$ kfl projects create my-api
✓ Project "my-api" created with environments: Dev, Prod

$ kfl projects create bare-project --environmentless
✓ Project "bare-project" created

Next: add environments (e.g. dev and prod):
  kfl configs create dev --project bare-project
  kfl configs create prod --project bare-project

$ kfl projects list
NAME           ENVIRONMENTS  CREATED
my-api         2             2024-01-15
bare-project   0             2024-01-15
frontend       2             2024-01-16

$ kfl projects delete frontend
⚠️  Delete project "frontend" and ALL its secrets? [y/N] y
✓ Project "frontend" deleted (2 environments, 14 secrets removed)
```

---

### `kfl configs`

Manage environments (called "configs" in CLI, like Doppler).

```bash
# List environments in a project
kfl configs list --project <name>

# Create a new environment
kfl configs create <env-name> --project <name>

# Delete an environment
kfl configs delete <env-name> --project <name>
```

**Examples:**
```bash
$ kfl configs create production --project my-api
✓ Config "production" created in project "my-api"

$ kfl configs list --project my-api
CONFIG        SECRETS  LAST UPDATED
development   12       2024-01-17
staging       12       2024-01-17
production    15       2024-01-18
```

---

### `kfl secrets`

Manage individual secrets within a config/environment.

```bash
# Set a single secret
kfl secrets set <KEY>=<VALUE> --project <name> --config <env>

# Set multiple secrets
kfl secrets set KEY1=val1 KEY2=val2 --project <name> --config <env>

# Get a single secret value
kfl secrets get <KEY> --project <name> --config <env>

# Delete a secret
kfl secrets delete <KEY> --project <name> --config <env>

# List secret keys (values hidden)
kfl secrets list --project <name> --config <env>
```

**Examples:**
```bash
$ kfl secrets set DATABASE_URL=postgres://... --project my-api --config production
✓ Set 1 secret in my-api/production

$ kfl secrets list --project my-api --config production
KEY                VALUE
DATABASE_URL       ****
REDIS_URL          ****
API_SECRET         ****
STRIPE_KEY         ****

$ kfl secrets get DATABASE_URL --project my-api --config production
postgres://user:pass@host:5432/db
```

---

### `kfl upload`

Upload an entire `.env` file to a config. **This is a full override** — all existing secrets in the target config are replaced.

```bash
kfl upload <file> --project <name> --config <env>
```

**Examples:**
```bash
$ kfl upload .env.production --project my-api --config production
⚠️  This will REPLACE all 15 secrets in my-api/production. Continue? [y/N] y
✓ Uploaded 18 secrets to my-api/production (15 replaced, 3 new)
```

The file is parsed as a standard `.env` file:
```env
# Comments are ignored
DATABASE_URL=postgres://user:pass@host:5432/db
REDIS_URL=redis://localhost:6379

# Multiline values with quotes
PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
-----END RSA PRIVATE KEY-----"
```

---

### `kfl download`

Download secrets to a file in various formats.

```bash
kfl download --project <name> --config <env> [options]

Options:
  --format <fmt>    Output format: env (default), json, yaml
  --output <file>   Write to file (default: stdout)
```

**Examples:**
```bash
# Download as .env to stdout
$ kfl download --project my-api --config production
DATABASE_URL=postgres://user:pass@host:5432/db
REDIS_URL=redis://localhost:6379
API_SECRET=sk_live_abc123

# Download as .env file
$ kfl download --project my-api --config development --output .env
✓ Written 12 secrets to .env

# Download as JSON
$ kfl download --project my-api --config production --format json
{
  "DATABASE_URL": "postgres://user:pass@host:5432/db",
  "REDIS_URL": "redis://localhost:6379",
  "API_SECRET": "sk_live_abc123"
}

# Download as JSON file
$ kfl download --project my-api --config production --format json --output config.json
✓ Written 15 secrets to config.json
```

---

### `kfl run` (Command Injection)

Run a command with secrets injected as environment variables. **This is the primary runtime integration.**

```bash
kfl run --project <name> --config <env> -- <command> [args...]
```

**Examples:**
```bash
# Inject production secrets into a build
$ kfl run --project my-api --config production -- npm run build

# Inject development secrets into a dev server
$ kfl run --project my-api --config development -- npm run dev

# Short form with defaults from config.yaml
$ kfl run -- npm run dev

# Use in CI/CD
$ kfl run --project my-api --config production -- docker build -t my-api .
```

How it works:
1. Fetches all secrets for the given project/config
2. Sets them as environment variables
3. Spawns the given command as a child process
4. Secrets exist only in the child process's memory — never written to disk

---

### `kfl keys`

Manage API keys. Requires a user key.

There are two types of API keys:

**User Keys** (`kfl_user_*`) — Full admin access.
- Can manage all projects, configs, secrets, and other API keys.
- No scoping required — has access to everything.
- Use for: developers, admins, backup keys.

**System Keys** (`kfl_sys_*`) — Scoped access for CI/CD and automation.
- Can only access specific project/environment combinations.
- Must specify scopes and permissions.
- Use for: CI/CD pipelines, deployment scripts, runtime services.

```bash
# List all keys (shows scopes and permissions)
kfl keys list

# Create a user key (full admin access)
kfl keys create --type user --label "my-admin-key"

# Revoke a key
kfl keys revoke <prefix>
```

#### Creating System Keys

System keys require `--scope` and `--permission` flags:

```bash
# Single scope, read-only (e.g., for CI to fetch secrets)
kfl keys create --type system \
  --label "github-actions-prod" \
  --scope "my-api:production" \
  --permission read

# Multiple scopes (repeat --scope for each)
kfl keys create --type system \
  --label "staging-deployer" \
  --scope "my-api:staging" \
  --scope "frontend:staging" \
  --scope "worker:staging" \
  --permission readwrite

# Wildcard environment (access to ALL environments in a project)
kfl keys create --type system \
  --label "local-dev" \
  --scope "my-api:*" \
  --permission readwrite

# Multiple projects with wildcards
kfl keys create --type system \
  --label "full-dev-access" \
  --scope "my-api:*" \
  --scope "frontend:*" \
  --permission readwrite
```

> **Note for Zsh users:** The `*` wildcard must be quoted to prevent shell glob expansion:
> ```bash
> # Wrong (Zsh will try to expand * as a glob pattern)
> kfl keys create --type system --label "dev" --scope my-api:* --permission read
> # zsh: no matches found: my-api:*
>
> # Correct (quote the scope)
> kfl keys create --type system --label "dev" --scope "my-api:*" --permission read
> ```

#### `kfl keys create` Flags

| Flag | Required For | Description |
|------|--------------|-------------|
| `--type <type>` | All | `user` or `system` |
| `--label <label>` | All | Human-readable label for the key |
| `--scope <project:env>` | System only | Scope for system keys. Repeatable. Use `*` for env wildcard. |
| `--permission <perm>` | System only | `read` or `readwrite` |

#### List Output Example

```
PREFIX          TYPE    LABEL              PERMISSION  SCOPES               CREATED
kfl_user_a1b2   user    bootstrap          full        *                    2024-01-15
kfl_sys_c3d4    system  github-actions     read        my-api:production    2024-01-16
kfl_sys_d4e5    system  deployer           readwrite   my-api:*, frontend:* 2024-01-17
```

#### `kfl keys put`

Update the scopes and permission of an existing system key. **This replaces ALL existing scopes** with the new set.

```bash
kfl keys put <prefix> --scope <project:env> [--scope ...] --permission <read|readwrite>
```

Use `kfl keys list` to see the current scopes, then copy and modify them as needed.

**Examples:**
```bash
# View current scopes
$ kfl keys list
PREFIX          TYPE    LABEL              PERMISSION  SCOPES               CREATED
kfl_sys_c3d4    system  github-actions     read        my-api:production    2024-01-16

# Add staging access (must include ALL scopes)
$ kfl keys put kfl_sys_c3d4 \
  --scope "my-api:production" \
  --scope "my-api:staging" \
  --permission read
✓ Key "kfl_sys_c3d4" updated

  Type:       system
  Label:      github-actions
  Permission: read
  Scopes:     my-api:production, my-api:staging

# Change from read-only to readwrite
$ kfl keys put kfl_sys_c3d4 \
  --scope "my-api:production" \
  --scope "my-api:staging" \
  --permission readwrite

# Use wildcard to grant access to all environments
$ kfl keys put kfl_sys_c3d4 \
  --scope "my-api:*" \
  --permission readwrite
```

> **Note:** User keys cannot have their scopes updated (they always have full access). Only system keys can be modified with `kfl keys put`.

#### `kfl keys put` Flags

| Flag | Required | Description |
|------|----------|-------------|
| `--scope <project:env>` | Yes | Scope: project:environment. Repeatable. Replaces ALL existing scopes. |
| `--permission <perm>` | Yes | `read` or `readwrite` |

**User key example:**
```bash
kfl keys create --type user --label "backup-admin"
# Output: kfl_user_abc123...
```

**System key examples:**
```bash
# Read-only access to production
kfl keys create --type system --label "ci-prod" \
  --scope "my-api:production" --permission read

# Read-write access to all environments in a project
kfl keys create --type system --label "dev-script" \
  --scope "my-api:*" --permission readwrite
```

See [API Keys & Access Control](./03-api-keys-and-access.md) for the full authorization model.

---

### `kfl dev`

Local development helpers. **No Cloudflare account required** — everything runs via Miniflare/wrangler locally.

#### `kfl dev init`

One-time local setup: generates a `MASTER_KEY`, applies D1 migrations, bootstraps the DB, and saves credentials pointing at `http://localhost:8787`.

```bash
kfl dev init [--force]
```

`--force` regenerates the local `MASTER_KEY` (existing local data becomes unreadable).

What it does:
1. Generates a random `MASTER_KEY` and writes it to `packages/server/.dev.vars`
2. Applies all Drizzle migrations to the local Miniflare D1 database
3. Briefly starts `wrangler dev` in the background
4. Calls `POST /bootstrap` → saves root key + `http://localhost:8787` to `~/.config/keyflare/`

```
$ kfl dev init

🔥 Keyflare Local Setup

✓ Local master key ready (packages/server/.dev.vars)
✓ Local database schema up-to-date
✓ Local server ready at http://localhost:8787
✓ Root API key created

✓ Local setup complete!

Your root API key (saved to ~/.config/keyflare/):

  kfl_user_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6

Start the local server anytime with:

  kfl dev server

Or set these env vars to use the local instance:

  KEYFLARE_LOCAL=true
  KEYFLARE_API_KEY=kfl_user_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
```

#### `kfl dev server`

Start the local Keyflare server. Blocks until Ctrl-C.

```bash
kfl dev server [--port <port>]
```

Run `kfl dev init` first to set up the local database.

```
$ kfl dev server
🔥 Keyflare Dev Server

Starting wrangler dev on port 8787...
Press Ctrl-C to stop.
```

#### Local mode

Set `KEYFLARE_LOCAL=true` (or configure `~/.config/keyflare/config.yaml` with `api_url: "http://localhost:8787"`) to make all `kfl` commands target the local server:

```bash
export KEYFLARE_LOCAL=true
export KEYFLARE_API_KEY=kfl_user_<your-local-key>

kfl projects create my-api
kfl configs create development --project my-api
kfl secrets set DB_URL=postgres://localhost --project my-api --config development
```

---

## Output Formats

| Format | Flag | Description |
|--------|------|-------------|
| `.env` | `--format env` | Standard dotenv format (`KEY=VALUE` per line) |
| JSON | `--format json` | Flat JSON object (`{ "KEY": "VALUE" }`) |
| YAML | `--format yaml` | Flat YAML (`KEY: VALUE` per line) |
| Shell export | `--format shell` | `export KEY="VALUE"` per line (sourceable) |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `KEYFLARE_API_KEY` | API key (overrides credentials file) |
| `KEYFLARE_API_URL` | API URL (overrides config file) |
| `KEYFLARE_LOCAL` | Set to `true` to target `http://localhost:8787` (implies local mode) |
| `KEYFLARE_PROJECT` | Default project (overrides config file) |
| `KEYFLARE_CONFIG` | Default config/environment (overrides config file) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token used by `kfl init` (skips auth prompt) |
| `DEBUG` | Set to `keyflare` to enable CLI debug logs (for example: `DEBUG=keyflare kfl init`). Logs include scoped prefixes like `[config]` and support printf-style placeholders (`%s`, `%d`, `%o`). |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Authentication error (invalid/revoked key) |
| 3 | Authorization error (insufficient scope/permissions) |
| 4 | Resource not found (project/config doesn't exist) |
| 5 | Network error (can't reach API) |

---

Next: [API Reference →](./05-api-reference.md)
