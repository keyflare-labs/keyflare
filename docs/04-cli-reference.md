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

Bootstrap a new Keyflare deployment on your Cloudflare account.

```bash
kfl init
```

Interactive flow:
1. Prompts for Cloudflare API token (or uses `CLOUDFLARE_API_TOKEN`)
2. Creates D1 database (`keyflare-db`)
3. Generates master encryption key (256-bit)
4. Deploys Worker with D1 binding
5. Pushes `MASTER_KEY` as Worker secret
6. Runs database migrations
7. Calls `/bootstrap` to create first user key
8. Saves API URL and key to `~/.config/keyflare/`

```
$ kfl init
✓ Cloudflare API token verified (account: my-account)
✓ Created D1 database: keyflare-db (id: abc123...)
✓ Generated master encryption key
✓ Deployed Keyflare Worker: https://keyflare.my-account.workers.dev
✓ Master key pushed to Worker secrets
✓ Database schema initialized
✓ Bootstrap complete

Your root API key (save this — it will NOT be shown again):

  kfl_user_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6

Configuration saved to ~/.config/keyflare/
```

---

### `kfl projects`

Manage projects.

```bash
# List all projects
kfl projects list

# Create a new project
kfl projects create <name>

# Delete a project (and all its environments/secrets)
kfl projects delete <name>
```

**Examples:**
```bash
$ kfl projects create my-api
✓ Project "my-api" created

$ kfl projects list
NAME        ENVIRONMENTS  CREATED
my-api      3             2024-01-15
frontend    2             2024-01-16

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

# Short form with defaults from config.toml
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

```bash
# List all keys
kfl keys list

# Create a user key
kfl keys create --type user --label <label>

# Create a system key with scopes
kfl keys create --type system --label <label> --scope <project:env> [--scope ...] --permission <read|readwrite>

# Revoke a key
kfl keys revoke <prefix>
```

See [API Keys & Access Control](./03-api-keys-and-access.md) for detailed examples.

---

### `kfl dev`

Helper commands for local development.

```bash
# Generate a local master key and write to .dev.vars
kfl dev init

# Run the Keyflare server locally (wraps wrangler dev)
kfl dev server
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
| `KEYFLARE_PROJECT` | Default project (overrides config file) |
| `KEYFLARE_CONFIG` | Default config/environment (overrides config file) |

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
