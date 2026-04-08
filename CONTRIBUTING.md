# Contributing to Keyflare

Thanks for your interest in contributing. This doc explains how to work locally so you can run the app, tests, and make changes.

## Prerequisites

- **Node.js** ≥ 24
- **pnpm** ≥ 10

A Cloudflare account is **only required for remote deployment**. Local development runs entirely offline via Miniflare.

## One-time setup

```bash
git clone https://github.com/keyflare-labs/keyflare.git
cd keyflare

pnpm run setup
```

`pnpm run setup` installs dependencies and builds the CLI so the `kfl` binary is linked correctly in the workspace. Run it once after cloning (and after pulling if the CLI or shared package changes).

## Running Keyflare locally

You can run a full local instance without a Cloudflare account:

```bash
# One-time: generate local MASTER_KEY, apply migrations, bootstrap DB,
# and save credentials for localhost:8787
pnpm run dev:init

# Start the local server (separate terminal)
pnpm run dev:server
# → Keyflare listening at http://localhost:8787

# Point the CLI at the local server
export KEYFLARE_LOCAL=true
export KEYFLARE_API_KEY=kfl_user_<key-printed-by-dev-init>
```

Then use `pnpm kfl` for any CLI commands (e.g. `pnpm kfl projects list`, `pnpm kfl secrets set ...`). See [Development Guide](./docs/contributing/development.mdx) for the manual bootstrap alternative and what `dev:init` does under the hood.

## Using the CLI during development

From the repo root, always use:

```bash
pnpm kfl <command>
```

so you run the local CLI source (via `tsx`) rather than a globally installed build.

## Testing

Tests run in a Miniflare Worker runtime — no network or Cloudflare account required.

```bash
# All packages
pnpm test

# Server integration tests only
pnpm --filter @keyflare/server test
```

For long-running test runs you can use [gob](https://github.com/matthias-hausberger/gob) (optional): `gob run pnpm --filter @keyflare/server test`.

## Building and type checking

```bash
pnpm run build        # all packages
pnpm run typecheck    # type-check all packages
pnpm run lint         # lint all packages
```

Build individual packages with `pnpm --filter @keyflare/<package> build` (e.g. `@keyflare/shared`, `@keyflare/server`, `@keyflare/cli`).

## Database migrations

The schema lives in `packages/server/src/db/schema.ts`. **Do not edit migration SQL files by hand** — use Drizzle:

```bash
cd packages/server

# 1. Edit src/db/schema.ts

# 2. Generate migration
pnpm run db:generate

# 3. Apply locally
pnpm run db:migrate:local
```

Generated migrations are committed; tests apply them automatically. See [Development Guide — Database Migrations](./docs/06-development.md#database-migrations-drizzle).

## Documentation

When you change behaviour, APIs, or schema, update the relevant docs so the change is reflected for users and future contributors.

| Change type              | Update |
|--------------------------|--------|
| New/changed API endpoint | `docs/05-api-reference.md` |
| New/changed CLI command  | `docs/04-cli-reference.md` |
| Schema change            | `docs/01-architecture.md` (D1 Schema) |
| New dependency / tech    | `docs/01-architecture.md` (Technology Choices) |
| Dev workflow             | `docs/06-development.md` |
| Deployment / init flow   | `docs/07-deployment.md` |
| Access control           | `docs/03-api-keys-and-access.md` |
| Security model           | `docs/02-security-model.md` |

## Submitting changes

1. Open an issue or comment on an existing one to align on the approach if the change is non-trivial.
2. Branch from `main`, make your changes, and run `pnpm test`, `pnpm run typecheck`, and `pnpm run lint`.
3. Update the docs as above if your change affects behaviour or APIs.
4. Open a pull request with a clear description and, if relevant, a link to the issue.

By contributing, you agree that your contributions will be licensed under the project's MIT license.
