# Keyflare — Deployment & Operations

## First-Time Deployment

### Via `kfl init` (Recommended)

`kfl init` automates the entire setup. It supports two authentication methods and auto-detects existing Wrangler login first (`npx wrangler whoami --json`):

```bash
kfl init
```

If Wrangler is not already logged in (and no API token is set), you will be prompted to choose:

```
? How would you like to authenticate with Cloudflare?
❯ Browser (OAuth) — opens cloudflare.com in your browser
  API Token — paste a Cloudflare API token
```

**OAuth flow** — no token management required:
- Opens `cloudflare.com` in your browser via `wrangler login`
- Wrangler caches the OAuth session locally
- Subsequent `kfl init` runs reuse the session automatically

**API token flow**:
- Generate a token at https://dash.cloudflare.com/profile/api-tokens
  - Required permissions: `Workers Scripts:Edit`, `D1:Edit`, `Workers Routes:Edit`
- Paste it when prompted
- Or set `CLOUDFLARE_API_TOKEN=<token>` in the environment to skip the prompt entirely (CI-friendly)

**What `kfl init` does:**

1. Checks current Wrangler auth (`npx wrangler whoami --json`)
2. Reuses existing login if present, otherwise uses `CLOUDFLARE_API_TOKEN` or prompts for auth method
3. Verifies Cloudflare credentials (`wrangler whoami`)
4. Deploys the Worker via `wrangler deploy` (Wrangler auto-provisions D1 from config)
5. Checks if `MASTER_KEY` exists on the worker
6. If missing, generates a 256-bit `MASTER_KEY` and stores it as a Worker secret
7. Applies Drizzle migrations via `wrangler d1 migrations apply keyflare --remote`
8. Calls `POST /bootstrap` to create the first root user key (idempotent)
9. Saves the API URL and root key to `~/.config/keyflare/`

```
$ kfl init

🔥 Keyflare — Initial Setup

? How would you like to authenticate with Cloudflare?
❯ Browser (OAuth)

✓ Authenticated as: my-account
✓ Worker deployed: https://keyflare.my-account.workers.dev
✓ No MASTER_KEY secret found
✓ Master key stored as Worker secret

⚠ MASTER KEY — Save this somewhere safe. It cannot be recovered!

  K7gNU3sdo+OL0wNhqoVWhr3g6s1xYv72ol/pe/Unols=

? I have saved the master key  Yes

✓ Database migrations applied
✓ Root API key created

✓ Keyflare deployed successfully!

Your root API key (already saved to ~/.config/keyflare/):

  kfl_user_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
```

---

### Manual Deployment (Step-by-step)

If you prefer full control:

```bash
# 1. Authenticate
wrangler login
# or: export CLOUDFLARE_API_TOKEN=<token>

# 2. Deploy the Worker (Wrangler provisions D1 from wrangler.jsonc)
cd packages/server
npx wrangler deploy

# 3. Generate + store MASTER_KEY
MASTER_KEY=$(openssl rand -base64 32)
echo "SAVE THIS: $MASTER_KEY"
echo "$MASTER_KEY" | npx wrangler secret put MASTER_KEY

# 4. Apply migrations
pnpm --filter @keyflare/server db:migrate:remote

# 5. Bootstrap
curl -X POST https://keyflare.<account>.workers.dev/bootstrap
# Save the returned key!
```

---

## Deployment Architecture

```
                    Internet
                       │
                       ▼
            ┌─────────────────────┐
            │   Cloudflare Edge   │
            │                     │
            │  ┌───────────────┐  │
            │  │   TLS/HTTPS   │  │  ← All traffic encrypted in transit
            │  └───────┬───────┘  │
            │          │          │
            │  ┌───────▼───────┐  │
            │  │   Keyflare    │  │  ← Single Worker
            │  │   Worker      │  │
            │  │               │  │
            │  │  MASTER_KEY   │  │  ← In-memory only (Worker Secret)
            │  └───────┬───────┘  │
            │          │          │
            │  ┌───────▼───────┐  │
            │  │    keyflare   │  │
            │  │   D1 (SQLite) │  │  ← Single database, encrypted secret data
            │  └───────────────┘  │
            │                     │
            └─────────────────────┘

Total infrastructure: 1 Worker + 1 D1 database + 1 secret
```

---

## Updates

When you update the Keyflare CLI package (`npm install -g @keyflare/cli` or similar), you can update your Cloudflare deployment by running `kfl init` again:

```bash
kfl init
```

`kfl init` is idempotent. Re-running it on an existing deployment:

- redeploys the Worker,
- keeps the existing `MASTER_KEY` secret unchanged,
- runs pending migrations,
- and safely re-calls bootstrap (no-op if already initialized).

> **Note:** Deleting the worker does NOT delete the D1 database. To also delete the database: `wrangler d1 delete keyflare`

### Manual Update

If you prefer full control:

```bash
# Pull latest source
git pull
pnpm run setup

# If there are new migrations:
pnpm --filter @keyflare/server db:migrate:remote

# Redeploy
pnpm --filter @keyflare/server deploy
```

The MASTER_KEY and all data persist across redeployments.

---

## Custom Domains

```bash
# Via Cloudflare dashboard:
# Workers & Pages → keyflare → Settings → Triggers → Custom Domains
# Add: secrets.yourdomain.com

# Or via wrangler.jsonc (then redeploy):
# [routes]
# pattern = "secrets.yourdomain.com/*"
# zone_name = "yourdomain.com"
```

---

## Monitoring

### Worker Logs

```bash
# Real-time log tailing
cd packages/server && npx wrangler tail

# Filter errors only
npx wrangler tail --status error
```

### Health Check

```bash
curl https://keyflare.<account>.workers.dev/health
# → { "ok": true, "data": { "ok": true, "version": "0.1.0" } }
```

### D1 Metrics

Available in the Cloudflare dashboard under **Workers & Pages → D1**:
- Query count, rows read/written, database size, error rate

---

## Backup & Recovery

### D1 Backup

Cloudflare automatically backs up D1. You can also export manually:

```bash
cd packages/server
npx wrangler d1 export keyflare --output backup.sql
```

### Master Key Backup

**The MASTER_KEY is the single most critical piece of infrastructure.** Without it, encrypted secret data is permanently unrecoverable — there is no backdoor.

Recommended storage:
1. Password manager (1Password, Bitwarden)
2. Printed and stored in a physical safe
3. HSM for enterprise setups

**Never store the master key in:**
- The git repository
- Plain text files on disk
- CI environment variables (use a dedicated secrets manager)
- The D1 database itself

### Disaster Recovery

| Scenario | Recovery |
|----------|----------|
| Worker deleted | Redeploy via `wrangler deploy`. Push MASTER_KEY again. D1 data is intact. |
| D1 data corrupted | Restore from Cloudflare automatic backups. |
| D1 deleted | Restore from exported `backup.sql` + push MASTER_KEY. |
| MASTER_KEY lost | **Unrecoverable.** Create a new Keyflare instance, re-upload all secrets. |
| MASTER_KEY compromised | Revoke all API keys. Create new instance with new key. Re-upload secrets. |
| API key compromised | `kfl keys revoke <prefix>` — takes effect immediately. |

---

## Scaling Considerations

| Resource | Free tier limit | Paid limit | Notes |
|----------|----------------|------------|-------|
| Worker requests | 100K/day | Unlimited | Per-request billing on paid |
| D1 storage | 5 GB | 10 GB+ | Per-database |
| D1 rows read | 5M/day | 50B/month | |
| D1 rows written | 100K/day | 50M/month | |
| Worker CPU time | 10ms | 30s | Crypto ops are fast (< 1ms) |

For most teams the free tier is more than sufficient.

---

Back to [Architecture →](./01-architecture.md)
