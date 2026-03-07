# 🔐 Keyflare

**Open-source secrets manager built entirely on Cloudflare.**

One Worker. One D1 database. One master key. Zero trust storage.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/keyflare/keyflare)

---

## What is Keyflare? 🔥

Keyflare is a self-hosted secrets manager (like [Doppler](https://doppler.com) or [Infisical](https://infisical.com)) that runs entirely on Cloudflare's infrastructure — a single Worker + a single D1 database. All secrets are encrypted at rest with AES-256-GCM.

### Key Features

- **🏗️ Single deployment** — One Cloudflare Worker + one D1 database. No VMs, no containers, no infra to manage.
- **🔒 Encrypted at rest** — All secret keys and values are AES-256-GCM encrypted. Even with full DB access, data is unreadable.
- **🔑 Scoped API keys** — User keys for management, system keys scoped to specific projects/environments.
- **📦 Projects & environments** — Organize secrets by project (`my-api`) and environment (`production`, `staging`, `development`).
- **💉 Runtime injection** — `kfl run -- npm start` injects secrets as env vars without writing to disk.
- **📄 Multi-format export** — Download as `.env`, JSON, YAML, or shell exports.
- **🚀 CLI-first** — Everything managed via the `kfl` command-line tool.

## Getting started 🚀

```bash
# Install the CLI
npm install -g @keyflare/cli

# Deploy Keyflare to your Cloudflare account
kfl init

# Create a project and environment
kfl projects create my-api
kfl configs create production --project my-api

# Upload secrets from a .env file
kfl upload .env.production --project my-api --config production

# Inject secrets into a command
kfl run --project my-api --config production -- npm run build

# Download secrets as .env file
kfl download --project my-api --config production --output .env
```

## Deploy to Cloudflare ☁️ (self-hosted)

You can deploy Keyflare to your own Cloudflare account in one click using the [Deploy to Cloudflare](https://developers.cloudflare.com/workers/platform/deploy-buttons/) button. Cloudflare will clone this repo, provision the D1 database, and deploy the Worker.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/keyflare/keyflare)

After deploying, use the CLI (`kfl init` with your Worker URL) or follow [Deployment](./docs/07-deployment.md) to configure the master key and API keys.

## Architecture

```
CLI (kfl) ──HTTPS──▶ Cloudflare Worker ──▶ D1 (encrypted)
                          │
                     MASTER_KEY
                   (Worker Secret)
```

- **Secrets** are encrypted with AES-256-GCM using a master key
- **API keys** are hashed with SHA-256 (128-bit entropy, brute-force infeasible)
- **Lookups** use HMAC-SHA256 (keyed hash — no plaintext in DB, not even key names)
- **Master key** stored as a Cloudflare Worker Secret (never in code, never in DB)

## Documentation

| Document | Description |
|----------|-------------|
| [Contributing](./CONTRIBUTING.md) | How to work locally and submit changes |
| [Architecture](./docs/01-architecture.md) | System design, data model, tech stack |
| [Security Model](./docs/02-security-model.md) | Encryption, hashing, threat model, master key management |
| [API Keys & Access](./docs/03-api-keys-and-access.md) | Key types, scoping, permissions, bootstrap flow |
| [CLI Reference](./docs/04-cli-reference.md) | All `kfl` commands and options |
| [API Reference](./docs/05-api-reference.md) | HTTP API endpoints |
| [Development Guide](./docs/06-development.md) | Local dev setup, project structure |
| [Deployment](./docs/07-deployment.md) | Production deployment, backup, disaster recovery |
| [Flow Diagrams](./docs/diagrams/flows.md) | Visual diagrams of all major flows (Mermaid) |

## Monorepo Structure

```
keyflare/
├── packages/
│   ├── server/     # Cloudflare Worker API
│   ├── cli/        # kfl command-line tool
│   └── shared/     # Shared types & utilities
└── docs/           # Documentation & diagrams
```

## Security Model (TL;DR)

| What | How |
|------|-----|
| Secret values in DB | AES-256-GCM encrypted (per-row random IV) |
| Secret key names in DB | AES-256-GCM encrypted |
| Project/env names in DB | AES-256-GCM encrypted + HMAC-SHA256 hash for lookups |
| API keys in DB | SHA-256 hashed (128-bit entropy keys) |
| Master encryption key | Cloudflare Worker Secret (never in code/DB) |
| Key derivation | HKDF-SHA256 (separate keys for encryption vs HMAC) |
| Transport | TLS 1.3 (Cloudflare edge) |

**Single point of failure:** The master key. If lost, all data is unrecoverable. Back it up securely.

## License

MIT
