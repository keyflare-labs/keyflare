---
name: keyflare
description: Lightweight guide for using the Keyflare CLI (`kfl`) day to day. Use this whenever the user asks how to list/create projects, manage environments, set/get/list/delete secrets, create/revoke API keys, configure defaults, or run commands with injected secrets (for example `kfl run -- npm run dev`).
---

# Keyflare CLI Usage

Use this skill for practical `kfl` usage help. Keep answers short, command-first, and focused on the user's next step.

## Response style

- Start with the exact command(s) the user should run.
- Prefer minimal explanation unless the user asks for details.
- Use concrete examples with `--project` and `--env` when relevant.
- Mention important caveats briefly (for example: upload replaces all secrets).

## Quick setup

```bash
# Log in to an existing Keyflare deployment
kfl login

# Optional defaults for current shell
export KEYFLARE_API_URL="https://keyflare.<account>.workers.dev"
export KEYFLARE_API_KEY="kfl_user_..."
export KEYFLARE_PROJECT="my-api"
export KEYFLARE_ENV="development"
```

If defaults are set, commands can often omit `--project` and `--env`.

## Common workflows

### Projects

```bash
# List projects
kfl projects list

# Create project (with default dev/prod envs)
kfl projects create my-api

# Create project without default envs
kfl projects create my-api --environmentless

# Delete project
kfl projects delete my-api
```

### Environments

```bash
# List envs in a project
kfl env list --project my-api

# Create env
kfl env create staging --project my-api

# Delete env
kfl env delete staging --project my-api
```

### Secrets

```bash
# Set one or multiple secrets
kfl secrets set DATABASE_URL=postgres://... --project my-api --env production
kfl secrets set KEY1=value1 KEY2=value2 --project my-api --env production

# Get/list/delete
kfl secrets get DATABASE_URL --project my-api --env production
kfl secrets list --project my-api --env production
kfl secrets delete DATABASE_URL --project my-api --env production

# Upload from .env (full override of target environment)
kfl secrets upload .env.production --project my-api --env production

# Download secrets
kfl secrets download --project my-api --env production
kfl secrets download --project my-api --env production --format json
kfl secrets download --project my-api --env production --output .env
```

### Run commands with injected secrets

```bash
# Explicit project/env
kfl run --project my-api --env development -- npm run dev
kfl run --project my-api --env production -- npm run build

# With defaults already configured
kfl run -- npm run dev
```

### API keys (brief)

```bash
# List keys
kfl keys list

# Create user key
kfl keys create --type user --label "backup-admin"

# Create scoped system key
kfl keys create --type system --label "github-actions" --scope "my-api:production" --permission read

# Update scopes/permission for system key
kfl keys put kfl_sys_abcd --scope "my-api:production" --scope "my-api:staging" --permission readwrite

# Revoke key
kfl keys revoke kfl_sys_abcd
```

## Quick pitfalls to mention

- `kfl secrets upload` replaces all existing secrets in the target environment.
- API keys are shown in full only once when created.
- Quote wildcard scopes in zsh: `--scope "my-api:*"`.
- `kfl keys put` replaces all scopes with the provided set.

## Example user requests and good responses

**Example 1**
Input: "how do I list projects and create one"
Output:

```bash
kfl projects list
kfl projects create my-api
```

**Example 2**
Input: "create a staging env for my-api"
Output:

```bash
kfl env create staging --project my-api
kfl env list --project my-api
```

**Example 3**
Input: "set DATABASE_URL in prod"
Output:

```bash
kfl secrets set DATABASE_URL=postgres://... --project my-api --env production
```

**Example 4**
Input: "run my app with keyflare secrets"
Output:

```bash
kfl run --project my-api --env development -- npm run dev
```

**Example 5**
Input: "download secrets as json"
Output:

```bash
kfl secrets download --project my-api --env production --format json
```
