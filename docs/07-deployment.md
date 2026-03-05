# Keyflare — Deployment & Operations

## First-Time Deployment

The recommended way to deploy Keyflare is via `kfl init`, which automates everything. Here's what happens under the hood:

### Step-by-step (Manual)

```bash
# 1. Authenticate with Cloudflare
wrangler login
# or: export CLOUDFLARE_API_TOKEN=<your-token>

# 2. Create the D1 database
wrangler d1 create keyflare-db
# Note the database_id from the output

# 3. Update wrangler.toml with the database ID
# In packages/server/wrangler.toml:
# [[d1_databases]]
# binding = "DB"
# database_name = "keyflare-db"
# database_id = "<your-database-id>"

# 4. Run migrations
wrangler d1 execute keyflare-db --file=./migrations/0001_init.sql

# 5. Generate master key
MASTER_KEY=$(openssl rand -base64 32)
echo "⚠️  SAVE THIS KEY: $MASTER_KEY"

# 6. Push master key as Worker secret
echo "$MASTER_KEY" | wrangler secret put MASTER_KEY

# 7. Deploy the Worker
cd packages/server
wrangler deploy

# 8. Bootstrap — create first API key
curl -X POST https://keyflare.<account>.workers.dev/bootstrap
# Save the returned key!
```

### Via `kfl init` (Automated)

```bash
kfl init
```

Does all of the above interactively. See [CLI Reference → init](./04-cli-reference.md#kfl-init).

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
            │  │   D1 (SQLite) │  │  ← Single database, encrypted data
            │  │   keyflare-db │  │
            │  └───────────────┘  │
            │                     │
            └─────────────────────┘

Total infrastructure: 1 Worker + 1 D1 database + 1 secret
```

## Custom Domains

By default, the Worker is available at `https://keyflare.<account>.workers.dev`. To use a custom domain:

```bash
# Via Cloudflare dashboard:
# Workers & Pages → keyflare → Settings → Triggers → Custom Domains
# Add: secrets.yourdomain.com

# Or via wrangler.toml:
# [routes]
# pattern = "secrets.yourdomain.com/*"
# zone_name = "yourdomain.com"
```

## Monitoring

### Worker Logs

```bash
# Real-time log tailing
wrangler tail

# Filter by status code
wrangler tail --status error
```

### D1 Metrics

Available in the Cloudflare dashboard:
- Query count
- Rows read/written
- Database size
- Error rate

### Health Check

```bash
# Simple health check endpoint
curl https://keyflare.<account>.workers.dev/health
# → { "ok": true, "version": "0.1.0" }
```

## Backup & Recovery

### D1 Backup

Cloudflare automatically creates D1 backups. You can also export manually:

```bash
# Export all tables (data is encrypted, but structure is preserved)
wrangler d1 export keyflare-db --output backup.sql
```

### Master Key Backup

**The master key is the most critical piece.** Without it, all data is unrecoverable.

Recommended backup locations:
1. Password manager (1Password, Bitwarden)
2. Printed copy in a physical safe
3. Hardware security module (HSM) for enterprise setups

**Never store the master key:**
- In the git repository
- In plain text on disk
- In the D1 database
- In environment variables in CI (use Keyflare itself or another secrets manager for the master key)

## Disaster Recovery

| Scenario | Recovery |
|----------|----------|
| Worker deleted | Redeploy from source. Push master key again. D1 data is intact. |
| D1 data corrupted | Restore from Cloudflare automatic backups. |
| D1 deleted | Restore from backup SQL + push master key. |
| Master key lost | **Unrecoverable.** All encrypted data is permanently lost. Create new instance. |
| Master key compromised | Revoke all API keys, create a new Keyflare instance with a new master key, re-upload all secrets. |
| API key compromised | Revoke the key immediately (`kfl keys revoke <prefix>`). |

## Scaling Considerations

| Resource | Limit (free tier) | Limit (paid) | Notes |
|----------|------------------|-------------|-------|
| Worker requests | 100K/day | Unlimited | Per-request billing on paid |
| D1 storage | 5 GB | 10 GB+ | Per-database |
| D1 rows read | 5M/day | 50B/month | |
| D1 rows written | 100K/day | 50M/month | |
| Worker CPU time | 10ms | 30s | Crypto operations are fast |

For most teams, the free tier is more than sufficient.

## Updates

To update Keyflare to a new version:

```bash
# Pull latest
git pull

# Install dependencies
npm install

# Run any new migrations
wrangler d1 execute keyflare-db --file=./migrations/XXXX_new_migration.sql

# Deploy
cd packages/server
wrangler deploy
```

The master key and data persist across deployments.

---

Back to [Architecture →](./01-architecture.md)
