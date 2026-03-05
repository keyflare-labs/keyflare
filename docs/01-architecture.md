# Keyflare — System Architecture

> Open-source secrets manager built entirely on Cloudflare infrastructure.

## Overview

Keyflare is a self-hosted secrets manager that runs as a **single Cloudflare Worker** backed by a **single D1 database**. It provides a CLI (`kfl`) for managing secrets across projects and environments, with fine-grained access control via scoped API keys.

Think of it as a self-hosted Doppler/Infisical that fits inside one Cloudflare Worker.

## Core Principles

1. **Single deployment target** — One Worker, one D1 database, one master secret. Nothing else.
2. **Zero trust storage** — All secret values and keys are encrypted at rest with AES-256-GCM. API keys are hashed with SHA-256. Even with full DB access, an attacker learns nothing.
3. **Minimal surface area** — No users, no sessions, no OAuth. Just API keys with scoped permissions.
4. **Simple mental model** — Projects → Environments → Key/Value secrets. That's it.

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
│   ├── server/          # Cloudflare Worker (Hono or raw fetch)
│   │   ├── src/
│   │   │   ├── index.ts           # Worker entry point
│   │   │   ├── routes/            # API route handlers
│   │   │   ├── middleware/        # Auth, validation
│   │   │   ├── crypto/           # Encryption/decryption/hashing
│   │   │   ├── db/               # D1 queries, schema, migrations
│   │   │   └── types.ts          # Env bindings
│   │   ├── wrangler.toml
│   │   └── migrations/          # D1 SQL migrations
│   │
│   ├── cli/             # CLI tool (kfl)
│   │   └── src/
│   │       ├── index.ts          # Entry point
│   │       ├── commands/         # Command implementations
│   │       ├── api/              # HTTP client for Keyflare API
│   │       └── output/           # Formatters (env, json, yaml)
│   │
│   └── shared/          # Shared types & utilities
│       └── src/
│           ├── types.ts          # API contracts, shared types
│           └── constants.ts      # Shared constants
│
├── docs/                # Documentation
├── .dev.vars.example    # Example local dev secrets
└── package.json         # Workspace root
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

## D1 Schema (Simplified)

```sql
-- API keys (both user and system)
CREATE TABLE api_keys (
    id              TEXT PRIMARY KEY,
    key_prefix      TEXT NOT NULL,          -- "kfl_user_abc1" (first 12 chars, for identification)
    key_hash        TEXT NOT NULL,          -- SHA-256 hash of full key
    type            TEXT NOT NULL,          -- 'user' | 'system'
    label           TEXT,                   -- Human-readable label (encrypted)
    scopes          TEXT,                   -- JSON array of {project, environment} (encrypted, null for user keys)
    permissions     TEXT NOT NULL,          -- 'read' | 'readwrite'
    created_at      TEXT NOT NULL,
    last_used_at    TEXT,
    revoked         INTEGER DEFAULT 0
);

-- Projects
CREATE TABLE projects (
    id              TEXT PRIMARY KEY,
    name_encrypted  TEXT NOT NULL,          -- AES-256-GCM encrypted
    name_hash       TEXT NOT NULL UNIQUE,   -- HMAC-SHA256 for lookups
    created_at      TEXT NOT NULL
);

-- Environments
CREATE TABLE environments (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id),
    name_encrypted  TEXT NOT NULL,          -- AES-256-GCM encrypted
    name_hash       TEXT NOT NULL,          -- HMAC-SHA256 for lookups
    created_at      TEXT NOT NULL,
    UNIQUE(project_id, name_hash)
);

-- Secrets (key-value pairs)
CREATE TABLE secrets (
    id              TEXT PRIMARY KEY,
    environment_id  TEXT NOT NULL REFERENCES environments(id),
    key_encrypted   TEXT NOT NULL,          -- AES-256-GCM encrypted
    key_hash        TEXT NOT NULL,          -- HMAC-SHA256 for lookups/dedup
    value_encrypted TEXT NOT NULL,          -- AES-256-GCM encrypted
    updated_at      TEXT NOT NULL,
    UNIQUE(environment_id, key_hash)
);
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
   │                                    │  4. HMAC project+env names │
   │                                    │  5. Query secrets by hash  │
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

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Runtime | Cloudflare Workers | Edge deployment, zero cold starts, built-in secrets management |
| Database | Cloudflare D1 (SQLite) | Zero config, co-located with Worker, SQL support |
| Encryption | AES-256-GCM (Web Crypto API) | Available natively in Workers runtime, authenticated encryption |
| Hashing (API keys) | SHA-256 (Web Crypto API) | API keys have 128-bit entropy — brute-force infeasible regardless of hash speed. Native, zero dependencies. |
| Hashing (lookups) | HMAC-SHA256 | Deterministic, keyed — allows lookups without exposing plaintext |
| CLI framework | Commander.js | Mature, TypeScript-native, great DX |
| Build | tsup / esbuild | Fast bundling for CLI; Worker uses wrangler built-in |
| Monorepo | npm workspaces | Simple, no extra tooling needed |

---

Next: [Security Model →](./02-security-model.md)
