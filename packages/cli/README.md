![Cover](https://github.com/keyflare-labs/keyflare/blob/main/docs/assets/logo-landscape.png?raw=true)

[![NPM](https://nodei.co/npm/@keyflare/cli.png?compact=true)](https://npmjs.org/package/@keyflare/cli)

**`kfl` — the CLI for Keyflare, the open-source secrets manager built entirely on Cloudflare. Runs on a free Cloudflare account.**

> 👉 **Full documentation at [keyflare.mintlify.app](https://keyflare.mintlify.app/)**

---

## Installation

```bash
npm install -g @keyflare/cli
```

## Quick Start

```bash
# Deploy Keyflare to your Cloudflare account (one-time setup)
kfl init

# Create a project and environment
kfl projects create my-api
kfl env create production --project my-api

# Upload secrets from a .env file
kfl upload .env.production --project my-api --env production

# Inject secrets into a command at runtime (no disk writes)
kfl run --project my-api --env production -- npm start

# Download secrets as a .env file
kfl download --project my-api --env production --output .env
```

## Configuration

After `kfl init`, credentials are stored in `~/.config/keyflare/`. You can override them with environment variables:

| Variable | Description |
|----------|-------------|
| `KEYFLARE_API_KEY` | API key (overrides the credentials file) |
| `KEYFLARE_API_URL` | API URL (overrides the config file) |
| `KEYFLARE_PROJECT` | Default project |
| `KEYFLARE_ENV` | Default environment |

→ [Full configuration reference](https://keyflare.mintlify.app/cli/cli-configuration)

## Commands

| Command | Description |
|---------|-------------|
| `kfl init` | Bootstrap a new Keyflare deployment |
| `kfl projects list/create/delete` | Manage projects |
| `kfl env list/create/delete` | Manage environments |
| `kfl secrets set/get/delete/list` | Manage individual secrets |
| `kfl upload <file>` | Upload a `.env` file (full replace) |
| `kfl download` | Download secrets (`.env`, JSON, YAML) |
| `kfl run -- <cmd>` | Inject secrets into a child process |
| `kfl keys list/create/revoke` | Manage API keys |
| `kfl dev init/server` | Local development helpers |

→ [Full CLI reference](https://keyflare.mintlify.app/cli/overview)

## Documentation

| Topic | Link |
|-------|-------|
| Quickstart | [keyflare.mintlify.app/getting-started/quickstart](https://keyflare.mintlify.app/getting-started/quickstart) |
| CLI Reference | [keyflare.mintlify.app/cli/overview](https://keyflare.mintlify.app/cli/overview) |
| API Keys & Access | [keyflare.mintlify.app/guides/api-keys](https://keyflare.mintlify.app/guides/api-keys) |
| Projects & Secrets | [keyflare.mintlify.app/guides/projects](https://keyflare.mintlify.app/guides/projects) |
| Architecture | [keyflare.mintlify.app/architecture/overview](https://keyflare.mintlify.app/architecture/overview) |
| Security Model | [keyflare.mintlify.app/architecture/security](https://keyflare.mintlify.app/architecture/security) |

## Contributing

We welcome all contributions — bug fixes, features, docs improvements, and ideas!

1. Fork the repo and create a branch
2. Make your changes (see the [development guide](https://keyflare.mintlify.app/contributing/development))
3. Run `npm run typecheck` and `npm test` to make sure everything passes
4. Open a pull request — we'll review it promptly

## License

MIT
