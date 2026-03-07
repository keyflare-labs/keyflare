# @keyflare/server

Keyflare API — Cloudflare Worker + D1 database.

This package is the server-side component of Keyflare. It runs as a single Cloudflare Worker backed by a D1 (SQLite) database. All secrets are encrypted at rest with AES-256-GCM using a master key stored as a Worker Secret.

## Getting Started

### Prerequisites

- Node.js >= 20
- npm >= 10
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)
- A Cloudflare account

### Local Development

```bash
# From the repo root, install all dependencies
npm install

# Copy the example dev vars file
cp ../../.dev.vars.example .dev.vars

# Apply migrations to the local D1 instance
npm run db:migrate:local

# Start the local dev server (runs on http://localhost:8787)
npm run dev
```

The `.dev.vars` file provides a local `MASTER_KEY` for development. It is safe to use a hardcoded key locally because the local D1 database is ephemeral.

### Bootstrap (first run)

After starting the local server for the first time, create the initial user API key:

```bash
curl -X POST http://localhost:8787/bootstrap
# Returns: { "ok": true, "data": { "key": "kfl_user_..." } }
```

Save the returned key — it will not be shown again.

### Deployment

The recommended way to deploy is via `kfl init`, which handles everything automatically:

```bash
kfl init
```

To deploy manually:

```bash
# Authenticate with Cloudflare
wrangler login

# Create the D1 database and note the database_id
wrangler d1 create keyflare-db

# Update wrangler.jsonc with your database_id, then run migrations
wrangler d1 migrations apply keyflare-db --remote

# Generate and push the master encryption key
openssl rand -base64 32 | wrangler secret put MASTER_KEY

# Deploy the Worker
npm run deploy
```

## Architecture

```
CLI (kfl) ──HTTPS──▶ Cloudflare Worker ──▶ D1 (encrypted)
                          │
                     MASTER_KEY
                   (Worker Secret)
```

- Secret values, key names, and project/environment names are **AES-256-GCM encrypted**.
- API keys are **SHA-256 hashed** — never stored in plaintext.
- Lookups use **HMAC-SHA256** so names never appear in the database.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start local dev server via `wrangler dev` |
| `npm run deploy` | Deploy to Cloudflare |
| `npm run build` | Type-check via `tsc --noEmit` |
| `npm test` | Run tests with Vitest + Miniflare |
| `npm run db:generate` | Generate a new D1 migration |
| `npm run db:migrate:local` | Apply migrations locally |
| `npm run db:migrate:remote` | Apply migrations to production D1 |

## Further Reading

- [Architecture](../../docs/01-architecture.md)
- [Security Model](../../docs/02-security-model.md)
- [API Reference](../../docs/05-api-reference.md)
- [Deployment Guide](../../docs/07-deployment.md)
