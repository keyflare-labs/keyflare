# Keyflare — Agent Guidelines

## Project Overview

Keyflare is an open-source secrets manager built entirely on Cloudflare (single Worker + single D1 database). TypeScript monorepo with npm workspaces.

**Packages:**
- `packages/server/` — Cloudflare Worker API (D1, AES-256-GCM encryption)
- `packages/cli/` — CLI tool (`kfl`) using Commander.js
- `packages/shared/` — Shared types & utilities

**Docs:** `docs/` — architecture, security model, API keys, CLI reference, API reference, dev guide, deployment. Start with `docs/01-architecture.md` for the full picture.

---

## Background Jobs with `gob`

Use `gob` for servers, long-running commands, and builds.

### When to Use gob

Use `gob` for:
- **Servers**: `gob add npm run dev`
- **Long-running processes**: `gob add npm run watch`
- **Builds**: `gob run make build`
- **Parallel build steps**: Run multiple builds concurrently

Do NOT use `gob` for:
- Quick commands: `git status`, `ls`, `cat`
- CLI tools: `jira`, `kubectl`, `todoist`
- File operations: `mv`, `cp`, `rm`

### gob Commands

- `gob add <cmd>` - Start command in background, returns job ID
- `gob add --description "context" <cmd>` - Start with description for context
- `gob run <cmd>` - Run and wait for completion (equivalent to `gob add` + `gob await`)
- `gob run --description "context" <cmd>` - Run with description for context
- `gob await <job_id>` - Wait for job to finish, stream output
- `gob list` - List jobs with IDs, status, and descriptions
- `gob logs <job_id>` - View stdout and stderr (stdout→stdout, stderr→stderr)
- `gob stdout <job_id>` - View current stdout (useful if job may be stuck)
- `gob stop <job_id>` - Graceful stop
- `gob restart <job_id>` - Stop + start

### Stuck Detection

`gob run` and `gob await` automatically detect potentially stuck jobs:
- Timeout: avg duration + 1 min (or 5 min if no history), triggers if no output for 1 min
- Job continues running in background
- Use `gob logs <id>` or `gob stdout <id>` to check output, `gob await <id>` to continue waiting

### Examples

Servers and long-running:
```
gob add npm run dev                              # Start dev server
gob add --description "File watcher" npm run watch  # With description
```

Builds:
```
gob run make build                           # Run build, wait for completion
gob run npm run test                         # Run tests, wait for completion
gob run --description "Type check" npm run typecheck  # With description
```

Regular commands (no gob):
```
git status
kubectl get pods
jira issue list
```