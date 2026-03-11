![Cover](https://github.com/keyflare-labs/keyflare/blob/main/docs/assets/logo-landscape.png?raw=true)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/keyflare/keyflare)
[![NPM](https://nodei.co/npm/@keyflare/cli.png?compact=true)](https://npmjs.org/package/@keyflare/cli)
**Open-source secrets manager built entirely on Cloudflare.**
One Worker. One D1 database. One master key. Zero trust storage. CLI-based.

## What is Keyflare? 🔥

Keyflare is a *free, self-hosted secrets manager* (like [Doppler](https://doppler.com) or [Infisical](https://infisical.com)) that runs entirely on Cloudflare's infrastructure — a single Worker + a single D1 database. All secrets are encrypted at rest with AES-256-GCM. You can use Cloudflare's **free plan** without any issues.

### Key Features

- **🤑 Completely free with no limits** — You can host your secrets manager on Cloudflare with practically no limits. Infinite projects, environments and secrets.
- **🚀 CLI-first** — Everything managed via the `kfl` command-line tool.
- **🏗️ Single deployment** — One Cloudflare Worker + one D1 database. No VMs, no containers, no infra to manage.
- **🔑 Scoped API keys** — User keys for management, system keys scoped to specific projects/environments.
- **📦 Projects & environments** — Organize secrets by project (`my-api`) and environment (`production`, `staging`, `development`).
- **💉 Runtime injection** — `kfl run -- npm start` injects secrets as env vars without writing to disk.
- **📄 Multi-format export** — Download as `.env`, JSON, YAML, or shell exports.
- **🔒 Encrypted at rest** — All secret keys and values are AES-256-GCM encrypted. Even with full DB access, data is unreadable.

## Getting started 🚀
> 👉 **Read the full documentation at [keyflare.mintlify.app](https://keyflare.mintlify.app/)**


```bash
# Install the CLI
npm install -g @keyflare/cli

# Deploy Keyflare to your Cloudflare account
kfl init

# Create a project and environment
kfl projects create my-api
kfl env create production --project my-api

# Upload secrets from a .env file
kfl upload .env.production --project my-api --env production

# Inject secrets into a command
kfl run --project my-api --env production -- npm run build

# Download secrets as .env file
kfl download --project my-api --env production --output .env
```

## Documentation
> 👉 **Read the full documentation at [keyflare.mintlify.app](https://keyflare.mintlify.app/)**

## Monorepo Structure

```
keyflare/
├── packages/
│   ├── server/     # Cloudflare Worker API
│   ├── cli/        # kfl command-line tool
│   └── shared/     # Shared types & utilities
└── docs/           # Documentation & diagrams
```

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

**Single point of failure:** The master key. If lost, all data is unrecoverable. Back it up securely. _The master key is shown once during `kfl init`_.

## License

MIT
