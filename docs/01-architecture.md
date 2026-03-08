# Keyflare — System Architecture

> Open-source secrets manager built entirely on Cloudflare infrastructure.

## Overview

Keyflare is a self-hosted secrets manager that runs as a **single Cloudflare Worker** backed by a **single D1 database**. It provides a CLI (`kfl`) for managing secrets across projects and environments, with fine-grained access control via scoped API keys.

Think of it as a self-hosted Doppler/Infisical that fits inside one Cloudflare Worker.

## Core Principles

1. **Single deployment target** — One Worker, one D1 database, one master secret. Nothing else.
2. **Zero trust storage** — Secret keys and values are encrypted at rest with AES-256-GCM. API keys are hashed with SHA-256. Even with full DB access, secret contents remain protected.
3. **Minimal surface area** — No users, no sessions, no OAuth. Just API keys with scoped permissions.
4. **Simple mental model** — Projects → Environments → Key/Value secrets. That's it. New projects get two default environments (**Dev** and **Prod**) unless created with the `environmentless` option (API) or `--environmentless` flag (CLI).

## Infrastructure

```
┌─────────────────────────────────────────────────────────┐
│                   Cloudflare Edge                       │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │              Keyflare Worker                      │  │
│  │                                                   │  │
│  │  ┌─────────┐  ┌──────────┐  ┌─────────────────┐  │  │
│  │  │  Auth   │  │  API     │  │  Crypto Engine  │  │  │
│  │  │  Layer  │──│  Routes  │──│  (AES-256-GCM)  │  │  │
│  │  └─────────┘  └──────────┘  └─────────────────┘  │  │
│  │       │                            │              │  │
│  │       │         MASTER_KEY         │              │  │
│  │       │      (Worker Secret)       │              │  │
│  │       │            │               │              │  │
│  │  ┌────▼────────────▼───────────────▼──────────┐   │  │
│  │  │              D1 Database                   │   │  │
│  │  │                                            │   │  │
│  │  │  ┌──────────┐ ┌──────────┐ ┌───────────┐  │   │  │
│  │  │  │ api_keys │ │ projects │ │  secrets   │  │   │  │
│  │  │  │ (hashed) │ │          │ │(encrypted) │  │   │  │
│  │  │  └──────────┘ └──────────┘ └───────────┘  │   │  │
│  │  └────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Monorepo Structure

```
keyflare/
├── packages/
│   ├── server/    # Cloudflare Worker — routes, middleware, crypto, db, test
│   ├── cli/       # CLI (kfl) — Commander, commands, API client
│   └── shared/    # Shared types & utilities
├── docs/
└── package.json
```

## Data Model

### Projects

A project is a namespace for secrets (e.g., `my-api`, `frontend-app`).

### Environments

Each project has environments (e.g., `production`, `staging`, `development`). Environments contain the actual secrets.

### Secrets

Key-value pairs stored per environment. Both key names and values are encrypted in D1.

### API Keys

Two types:

- **User keys** (`kfl_user_*`) — God mode. Full unrestricted access to everything: projects, environments, secrets, and API key management.
- **System keys** (`kfl_sys_*`) — Scoped to specific `(project, environment)` pairs with either `read` or `readwrite` permission on secrets only. Cannot create projects, environments, or other keys. Designed for CI/CD and runtime injection.

## D1 Schema

The schema is defined in TypeScript via **Drizzle ORM** (`packages/server/src/db/schema.ts`) and SQL migrations are generated from it with `drizzle-kit`. The migration files in `migrations/` are the source of truth for what gets applied to the database — never edit them by hand.

```
# To generate a new migration after editing schema.ts:
cd packages/server
npm run db:generate

# To apply locally:
npm run db:migrate:local

# To apply to production:
npm run db:migrate:remote
```

**Drizzle schema (simplified view):**

```typescript
// api_keys — both user and system keys
apiKeys: {
  id              text PK
  key_prefix      text NOT NULL       -- "kfl_user_abc1" (first 12 chars, for display)
  key_hash        text NOT NULL UNIQUE -- SHA-256(full_key)
  type            "user" | "system"
  label           text                -- AES-256-GCM encrypted
  scopes          text                -- AES-256-GCM encrypted JSON array, null for user keys
  permissions     "read" | "readwrite" | "full"
  created_at      text NOT NULL
  last_used_at    text
  revoked         integer DEFAULT 0
}

// projects
projects: {
  id              text PK
  name            text NOT NULL UNIQUE -- plaintext project name
  created_at      text NOT NULL
}

// New projects get default environments "Dev" and "Prod" unless created with environmentless flag.

// environments (configs)
environments: {
  id              text PK
  project_id      text → projects.id ON DELETE CASCADE
  name            text NOT NULL       -- plaintext environment name
  created_at      text NOT NULL
  UNIQUE(project_id, name)
}

// secrets
secrets: {
  id              text PK
  environment_id  text → environments.id ON DELETE CASCADE
  key_encrypted   text NOT NULL       -- AES-256-GCM encrypted
  key_hash        text NOT NULL       -- HMAC-SHA256 for lookups/dedup
  value_encrypted text NOT NULL       -- AES-256-GCM encrypted
  updated_at      text NOT NULL
  UNIQUE(environment_id, key_hash)
}
```

## Request Flow

```
CLI (kfl)                         Keyflare Worker                    D1
   │                                    │                             │
   │  POST /secrets/get                 │                             │
   │  Authorization: Bearer kfl_sys_... │                             │
   │  { project, environment }          │                             │
   │───────────────────────────────────>│                             │
   │                                    │                             │
   │                                    │  1. Hash API key            │
   │                                    │  2. Look up hash in D1     │
   │                                    │────────────────────────────>│
   │                                    │  3. Verify key + scopes    │
   │                                    │<────────────────────────────│
   │                                    │                             │
   │                                    │  4. Look up project+env by name │
   │                                    │  5. Query secrets by env id     │
   │                                    │────────────────────────────>│
   │                                    │<────────────────────────────│
   │                                    │                             │
   │                                    │  6. Decrypt keys & values  │
   │                                    │     using MASTER_KEY       │
   │                                    │                             │
   │  { secrets: { KEY: "value", ... }} │                             │
   │<───────────────────────────────────│                             │
   │                                    │                             │
   │  7. Output as .env / JSON / inject │                             │
```

## Technology Choices

| Component          | Technology                    | Rationale                                                                                                     |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Web framework      | Hono                          | Ultrafast router, middleware, typed context; runs on Cloudflare Workers; exports `AppType` for RPC clients    |
| Request validation | Zod + `@hono/zod-validator`   | Declarative, route-level schema validation with strict payload parsing and consistent 400 responses          |
| API client (CLI)   | Hono RPC (`hc`)               | CLI uses `hc<AppType>` with an explicit client interface for typed requests; same paths and response envelope |
| Runtime            | Cloudflare Workers            | Edge deployment, zero cold starts, built-in secrets management                                                |
| Database           | Cloudflare D1 (SQLite)        | Zero config, co-located with Worker, SQL support                                                              |
| Encryption         | AES-256-GCM (Web Crypto API)  | Available natively in Workers runtime, authenticated encryption                                               |
| Hashing (API keys) | SHA-256 (Web Crypto API)      | API keys have 128-bit entropy — brute-force infeasible regardless of hash speed. Native, zero dependencies.   |
| Hashing (lookups)  | HMAC-SHA256                   | Deterministic keyed lookup for `secrets.key_hash` without storing plaintext secret keys                       |
| CLI framework      | Commander.js                  | Mature, TypeScript-native, great DX                                                                           |
| ORM / migrations   | Drizzle ORM + drizzle-kit     | Type-safe queries inferred from schema; generates versioned SQL migrations                                    |
| CLI UI             | chalk, ora, @inquirer/prompts | Coloured output, spinners, interactive prompts                                                                |
| Build              | tsup / esbuild                | Fast bundling for CLI; Worker uses wrangler built-in                                                          |
| Monorepo           | npm workspaces                | Simple, no extra tooling needed                                                                               |

---

Next: [Security Model →](./02-security-model.md)
