# Keyflare — API Keys & Access Control

## Key Types

| | User Key | System Key |
|---|---|---|
| **Prefix** | `kfl_user_*` | `kfl_sys_*` |
| **Access** | Full admin (all projects, keys, settings) | Scoped to specific project:environment |
| **Scoping** | None — access to everything | Required — one or more `project:env` pairs |
| **Permission** | Implicit full access | Required — `read` or `readwrite` |
| **Created by** | `kfl init` (bootstrap) or another user key | Any user key |
| **Use for** | Developers, admins, backup keys | CI/CD, deployment scripts, runtime services |

### User Keys (`kfl_user_*`)

- **Purpose:** Full management of the Keyflare instance.
- **Created by:** The `kfl init` command (bootstrap key) or another user key.
- **Can do:** Everything — create/delete projects, environments, secrets, and other API keys.
- **Scoping:** None. Full access to all resources.
- **Typical holder:** Developer, platform engineer, admin.

### System Keys (`kfl_sys_*`)

- **Purpose:** Scoped access for automated systems (CI/CD, runtime, local dev).
- **Created by:** A user key.
- **Can do:** Read (or read+write) secrets within their allowed scope.
- **Scoping:** List of `(project, environment)` pairs. Supports `*` wildcard for environment.
- **Typical holder:** CI/CD pipeline, deployment script, local `.env` loader.

## Bootstrap Flow

When you first deploy Keyflare, there are no API keys. The `kfl init` command handles bootstrapping:

```
┌──────────┐                    ┌──────────────┐                  ┌─────┐
│  User    │                    │  kfl init    │                  │ API │
│          │                    │  (CLI)       │                  │     │
└────┬─────┘                    └──────┬───────┘                  └──┬──┘
     │                                 │                             │
     │  1. kfl init                    │                             │
     │────────────────────────────────>│                             │
     │                                 │                             │
     │  2. Prompt: Cloudflare API token│                             │
     │<────────────────────────────────│                             │
     │  (for wrangler operations)      │                             │
     │────────────────────────────────>│                             │
     │                                 │                             │
     │                                 │  3. Create D1 database      │
     │                                 │     (wrangler d1 create)    │
     │                                 │                             │
     │                                 │  4. Generate MASTER_KEY     │
     │                                 │     (256-bit random)        │
     │                                 │                             │
     │                                 │  5. Push MASTER_KEY to      │
     │                                 │     Worker secrets          │
     │                                 │     (wrangler secret put)   │
     │                                 │                             │
     │                                 │  6. Deploy Worker           │
     │                                 │     (wrangler deploy)       │
     │                                 │                             │
     │                                 │  7. Run D1 migrations       │
     │                                 │     (create tables)         │
     │                                 │                             │
     │                                 │  8. POST /bootstrap         │
     │                                 │─────────────────────────────>
     │                                 │                             │
     │                                 │  Bootstrap endpoint:        │
     │                                 │  - Only works if 0 keys     │
     │                                 │    exist in DB              │
     │                                 │  - Creates first user key   │
     │                                 │  - Returns full key ONCE    │
     │                                 │                             │
     │                                 │  { key: "kfl_user_..." }   │
     │                                 │<─────────────────────────────
     │                                 │                             │
     │  9. Display key + save to       │                             │
     │     ~/.config/keyflare/config   │                             │
     │<────────────────────────────────│                             │
     │                                 │                             │
     │  ⚠️ "Save this key! It won't   │                             │
     │     be shown again."            │                             │
```

### Bootstrap Security

The `/bootstrap` endpoint is a one-time operation:
- Returns `409 Conflict` if any API keys already exist.
- No authentication required (there are no keys yet).
- Creates exactly one user key.
- After this, the endpoint is permanently disabled (keys exist).

## Key Lifecycle

### Creating Keys

```bash
# Create another user key (requires user key auth)
kfl keys create --type user --label "backup-admin-key"
# Output: kfl_user_b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7

# Create a system key for CI/CD (production only)
kfl keys create --type system \
  --label "github-actions-prod" \
  --scope "my-api:production" \
  --permission read
# Output: kfl_sys_c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8

# Create a system key for local dev (all envs in a project)
kfl keys create --type system \
  --label "local-dev" \
  --scope "my-api:*" \
  --permission readwrite
# Output: kfl_sys_d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9

# Create a key with multiple scopes
kfl keys create --type system \
  --label "staging-deployer" \
  --scope "my-api:staging" \
  --scope "frontend:staging" \
  --permission readwrite
```

### Listing Keys

```bash
kfl keys list

# Output:
# PREFIX          TYPE    LABEL                 PERMISSION  SCOPES                CREATED
# kfl_user_a1b2   user    bootstrap             full        *                     2024-01-15
# kfl_user_b2c3   user    backup-admin-key      full        *                     2024-01-16
# kfl_sys_c3d4    system  github-actions-prod   read        my-api:production     2024-01-16
# kfl_sys_d4e5    system  local-dev             readwrite   my-api:*              2024-01-17
```

The list shows:
- **PREFIX** — First 12 characters of the key (used for identification and revocation)
- **TYPE** — `user` (full admin) or `system` (scoped)
- **LABEL** — Human-readable name
- **PERMISSION** — `full` for user keys, `read` or `readwrite` for system keys
- **SCOPES** — Project:environment pairs for system keys, `*` for user keys
- **CREATED** — Creation date

Note: Only the prefix is shown. The full key is never retrievable after creation.

### Revoking Keys

```bash
kfl keys revoke kfl_sys_c3d4

# Output:
# ⚠️  Revoke key kfl_sys_c3d4 (github-actions-prod)? [y/N] y
# ✓ Key revoked. It can no longer authenticate.
```

Revocation is soft-delete (`revoked = 1`). The hash remains in the DB for audit purposes.

## Authorization Flow

```
Request arrives with Authorization: Bearer kfl_sys_xxxxx
            │
            ▼
┌───────────────────────┐
│  SHA-256(full_key)    │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐     ┌──────────────────┐
│  Look up key_hash     │────>│  Not found?      │──> 401 Unauthorized
│  in api_keys table    │     │  Revoked?         │──> 401 Unauthorized
└───────────┬───────────┘     └──────────────────┘
            │ Found + Active
            ▼
┌───────────────────────┐
│  Determine key type   │
│                       │
│  User key?  ─────────>│  Full access. Proceed.
│                       │
│  System key? ────────>│  Check scopes + permissions
└───────────┬───────────┘
            │ System key
            ▼
┌───────────────────────┐
│  Decrypt scopes       │
│  (AES-256-GCM)        │
│                       │
│  Does requested       │
│  (project, env) match │     ┌──────────────────┐
│  any scope entry?     │────>│  No match?       │──> 403 Forbidden
│                       │     └──────────────────┘
│  Is the operation     │
│  allowed by the       │     ┌──────────────────┐
│  permission level?    │────>│  read key trying │──> 403 Forbidden
│                       │     │  to write?        │
└───────────┬───────────┘     └──────────────────┘
            │ Authorized
            ▼
        Process request
```

## CLI Configuration

The CLI stores its configuration in `~/.config/keyflare/`:

```
~/.config/keyflare/
├── config.toml          # Default settings
└── credentials           # API key (plaintext — file permissions 0600)
```

**config.toml:**
```toml
[default]
api_url = "https://keyflare.<account>.workers.dev"
project = "my-api"          # Default project (optional)
environment = "development"  # Default environment (optional)
```

**credentials:**
```
kfl_user_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
```

Alternatively, the API key can be set via environment variable:
```bash
export KEYFLARE_API_KEY=kfl_user_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
```

Environment variable takes precedence over the credentials file.

---

Next: [CLI Reference →](./04-cli-reference.md)
