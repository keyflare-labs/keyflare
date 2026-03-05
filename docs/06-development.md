# Keyflare — Development Guide

## Prerequisites

- Node.js >= 20
- npm >= 10
- Cloudflare account (for deployment)
- Wrangler CLI (`npm i -g wrangler`)

## Getting Started

```bash
# Clone the repo
git clone https://github.com/matthias-hausberger/keyflare.git
cd keyflare

# Install all dependencies
npm install

# Set up local dev environment
cp .dev.vars.example packages/server/.dev.vars
```

## Local Development

### Server (Worker)

The server runs locally using `wrangler dev`, which provides a local D1 instance.

```bash
# Start the local dev server
cd packages/server
npm run dev
# → Running on http://localhost:8787
```

**`.dev.vars` for local development:**
```env
MASTER_KEY=keyflare-local-dev-master-key-not-for-production
```

This hardcoded key is fine for local development — the local D1 is ephemeral.

### CLI

```bash
# Run CLI commands during development
cd packages/cli
npm run dev -- projects list

# Or from repo root
npx tsx packages/cli/src/index.ts projects list
```

Set the CLI to point at your local server:
```bash
export KEYFLARE_API_URL=http://localhost:8787
export KEYFLARE_API_KEY=kfl_user_<your-local-bootstrap-key>
```

### Local Bootstrap

After starting the local server for the first time:

```bash
# Bootstrap (create first user key against local server)
curl -X POST http://localhost:8787/bootstrap
# Returns: { "ok": true, "data": { "key": "kfl_user_..." } }
```

## Project Structure

```
keyflare/
├── packages/
│   ├── server/              # Cloudflare Worker
│   │   ├── src/
│   │   │   ├── index.ts     # Worker entry (fetch handler)
│   │   │   ├── routes/      # Route handlers
│   │   │   │   ├── bootstrap.ts
│   │   │   │   ├── keys.ts
│   │   │   │   ├── projects.ts
│   │   │   │   ├── configs.ts
│   │   │   │   └── secrets.ts
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts       # API key verification
│   │   │   │   └── validate.ts   # Request validation
│   │   │   ├── crypto/
│   │   │   │   ├── encrypt.ts    # AES-256-GCM encrypt/decrypt
│   │   │   │   ├── hash.ts       # SHA-256, HMAC-SHA256
│   │   │   │   └── keys.ts       # HKDF key derivation
│   │   │   ├── db/
│   │   │   │   ├── schema.sql    # Full schema
│   │   │   │   └── queries.ts    # D1 query helpers
│   │   │   └── types.ts          # Env bindings, internal types
│   │   ├── migrations/
│   │   │   └── 0001_init.sql
│   │   ├── wrangler.toml
│   │   └── vitest.config.ts
│   │
│   ├── cli/                 # CLI (kfl)
│   │   ├── src/
│   │   │   ├── index.ts     # Commander setup
│   │   │   ├── commands/
│   │   │   │   ├── init.ts       # kfl init
│   │   │   │   ├── projects.ts   # kfl projects *
│   │   │   │   ├── configs.ts    # kfl configs *
│   │   │   │   ├── secrets.ts    # kfl secrets *
│   │   │   │   ├── upload.ts     # kfl upload
│   │   │   │   ├── download.ts   # kfl download
│   │   │   │   ├── run.ts        # kfl run
│   │   │   │   ├── keys.ts       # kfl keys *
│   │   │   │   └── dev.ts        # kfl dev *
│   │   │   ├── api/
│   │   │   │   └── client.ts     # HTTP client wrapper
│   │   │   ├── output/
│   │   │   │   ├── env.ts        # .env formatter
│   │   │   │   ├── json.ts       # JSON formatter
│   │   │   │   └── yaml.ts       # YAML formatter
│   │   │   └── config.ts         # Read/write ~/.config/keyflare/
│   │   └── tsup.config.ts
│   │
│   └── shared/              # Shared code
│       └── src/
│           ├── types.ts     # API request/response types
│           ├── constants.ts # Key prefixes, limits
│           └── parse-env.ts # .env file parser
│
├── docs/
├── .dev.vars.example
├── package.json             # npm workspaces root
└── tsconfig.base.json
```

## Testing

```bash
# Run all tests
npm test

# Run server tests
npm test --workspace=packages/server

# Run CLI tests
npm test --workspace=packages/cli

# Run with coverage
npm test -- --coverage
```

Server tests use Miniflare (via `vitest` + `@cloudflare/vitest-pool-workers`) for local Worker + D1 testing.

## Building

```bash
# Build all packages
npm run build

# Build individual packages
npm run build --workspace=packages/shared
npm run build --workspace=packages/server
npm run build --workspace=packages/cli
```

## Deployment

```bash
# Deploy to Cloudflare (from packages/server)
cd packages/server
wrangler deploy

# Or use kfl init for first-time setup
kfl init
```

## Debugging

```bash
# View Worker logs in real-time
wrangler tail

# View D1 data (be careful — data is encrypted)
wrangler d1 execute keyflare-db --command "SELECT id, key_prefix, type FROM api_keys"
```

---

Next: [Deployment & Operations →](./07-deployment.md)
