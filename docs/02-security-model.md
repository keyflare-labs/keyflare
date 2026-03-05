# Keyflare — Security Model

## Threat Model

Keyflare assumes the following threat scenarios:

| Threat | Mitigation |
|--------|-----------|
| D1 database dump / leak | All secret values, secret keys, and project/environment names are **AES-256-GCM encrypted**. API keys are **hashed**. Raw DB data is useless. |
| API key theft | Keys are scoped — a system key can only access specific project/environment combinations. Revocation is instant. |
| Network interception | All traffic to Cloudflare Workers is TLS-encrypted (HTTPS enforced). |
| Master key compromise | Single point of failure by design. See [Master Key Management](#master-key-management). |
| Brute-force API key guessing | API keys are 256-bit random. Keyspace is 2^256 — infeasible. Rate limiting at Cloudflare edge. |
| Insider threat (DB admin) | Even with full D1 access, encrypted data is unreadable without the master key, which lives only in Worker secrets. |

## Encryption Architecture

### Master Key

The **MASTER_KEY** is the single root of trust for the entire system.

```
┌──────────────────────────────────────────────────────────┐
│                    MASTER_KEY                             │
│              (256-bit, AES key)                           │
│                                                          │
│  Stored as: Cloudflare Worker Secret                     │
│  Set via:   wrangler secret put MASTER_KEY               │
│  Lives in:  Worker runtime memory only                   │
│  Backed by: Cloudflare's own secrets infrastructure      │
│                                                          │
│  ┌──────────────────┐    ┌──────────────────────────┐    │
│  │  Derived Key 1   │    │  Derived Key 2           │    │
│  │  (Encryption)    │    │  (HMAC for lookups)      │    │
│  │                  │    │                           │    │
│  │  HKDF-SHA256     │    │  HKDF-SHA256             │    │
│  │  info="encrypt"  │    │  info="hmac"             │    │
│  └────────┬─────────┘    └────────────┬─────────────┘    │
│           │                           │                  │
│           ▼                           ▼                  │
│   AES-256-GCM encrypt        HMAC-SHA256 for             │
│   all secret data            deterministic lookups        │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

We use **HKDF (HMAC-based Key Derivation Function)** to derive two separate keys from the master key:

1. **Encryption key** — Used for AES-256-GCM encryption/decryption of all stored data.
2. **HMAC key** — Used for HMAC-SHA256 to produce deterministic hashes for database lookups (e.g., finding a project by name without storing the plaintext name).

This separation ensures that even if the HMAC key were somehow exposed, the encryption key remains independent.

### Symmetric Encryption — Secret Values

All sensitive data in D1 is encrypted with **AES-256-GCM**:

```
Encrypt(plaintext):
    iv    = crypto.getRandomValues(12 bytes)
    key   = derived encryption key (from MASTER_KEY via HKDF)
    { ciphertext, tag } = AES-256-GCM.encrypt(key, iv, plaintext)
    stored = base64(iv || ciphertext || tag)

Decrypt(stored):
    raw        = base64_decode(stored)
    iv         = raw[0..12]
    ciphertext = raw[12..n-16]
    tag        = raw[n-16..n]
    plaintext  = AES-256-GCM.decrypt(key, iv, ciphertext, tag)
```

**What gets encrypted:**
- Secret values (`DB_PASSWORD=hunter2`)
- Secret key names (`DB_PASSWORD`)
- Project names
- Environment names
- API key labels
- System key scope definitions

**What is NOT encrypted (by design):**
- Row IDs (UUIDs, no information leakage)
- Timestamps (created_at, updated_at)
- API key type (`user` / `system`)
- API key permission level (`read` / `readwrite`)
- Revocation status

### HMAC for Lookups

To find records by name without storing plaintext, we use HMAC-SHA256:

```
LookupHash(name):
    key  = derived HMAC key (from MASTER_KEY via HKDF)
    hash = HMAC-SHA256(key, name)
    return hex(hash)
```

This is used for:
- `projects.name_hash` — find project by name
- `environments.name_hash` — find environment by name within a project
- `secrets.key_hash` — find/upsert secret by key name within an environment

HMAC is deterministic (same input → same hash) but keyed, so it's not reversible without the HMAC key.

## API Key Security

### Key Format

```
kfl_user_<32 random hex chars>     (User key — 128 bits of entropy)
kfl_sys_<32 random hex chars>      (System key — 128 bits of entropy)
```

Examples:
```
kfl_user_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
kfl_sys_f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3
```

The prefix (`kfl_user_` / `kfl_sys_`) makes it easy to identify key type and enables secret scanning tools (like GitHub's) to detect leaked keys.

### Key Storage

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│   User creates key via CLI                          │
│          │                                          │
│          ▼                                          │
│   Full key shown ONCE:  kfl_sys_a1b2c3...           │
│          │                                          │
│          ▼                                          │
│   Server receives full key                          │
│          │                                          │
│          ├──► key_prefix = "kfl_sys_a1b2"           │
│          │    (first 12 chars, stored plaintext      │
│          │     for identification in UI/CLI)         │
│          │                                          │
│          └──► key_hash = SHA-256(full_key)           │
│               (stored in D1, used for auth lookup)  │
│                                                     │
│   On each request:                                  │
│     1. Receive Authorization: Bearer <key>          │
│     2. Compute SHA-256(key)                         │
│     3. Look up hash in api_keys table               │
│     4. Verify not revoked                           │
│     5. Check scopes against requested resource      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

> **Why SHA-256 and not a slow hash like Argon2id?** API keys have 128 bits of entropy (compared to ~40 bits for human passwords), making brute-force infeasible regardless of hash speed. SHA-256 is fast, native to the Web Crypto API, and adds zero dependencies.

### Key Scoping (System Keys)

System keys carry an encrypted `scopes` field:

```json
[
  { "project": "my-api", "environment": "production" },
  { "project": "my-api", "environment": "staging" },
  { "project": "frontend", "environment": "*" }
]
```

- `"*"` means all environments within that project.
- User keys have no scopes — they have full access to everything.

### Permission Levels

| | Read secrets | Write secrets | Create/delete projects & envs | Manage API keys |
|---|:---:|:---:|:---:|:---:|
| **User key** (`kfl_user_*`) | ✅ | ✅ | ✅ | ✅ |
| **System key** — `read` | ✅ (scoped) | ❌ | ❌ | ❌ |
| **System key** — `readwrite` | ✅ (scoped) | ✅ (scoped) | ❌ | ❌ |

- **User keys** are god-mode — full access to everything, no restrictions.
- **System keys** can only read or read+write secrets within their scoped `(project, environment)` pairs. They cannot create projects, environments, or other API keys.

## Master Key Management

### Generation

```bash
# Generate a cryptographically random 256-bit key
openssl rand -base64 32
# Example output: K7gNU3sdo+OL0wNhqoVWhr3g6s1xYv72ol/pe/Unols=
```

### Deployment to Cloudflare

```bash
# Set as Worker secret (never stored in code or config files)
echo "<base64-key>" | wrangler secret put MASTER_KEY
```

### Local Development

For local development with `wrangler dev`, the master key is stored in `.dev.vars`:

```env
# .dev.vars (gitignored!)
MASTER_KEY=localdev-not-a-real-key-just-for-development
```

A hardcoded development key is acceptable because local D1 is ephemeral and contains no real secrets.

## Security Boundaries

```
┌─────────────────────────────────────────────────────────────────────┐
│ TRUST BOUNDARY: Cloudflare's Infrastructure                        │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ TRUST BOUNDARY: Worker Runtime                                │ │
│  │                                                                │ │
│  │  MASTER_KEY (in-memory only, from Worker Secrets)             │ │
│  │       │                                                        │ │
│  │       ├── Derived Encryption Key                               │ │
│  │       └── Derived HMAC Key                                     │ │
│  │                                                                │ │
│  │  Plaintext secrets exist ONLY here, in Worker memory,          │ │
│  │  during request processing. Never logged, never cached.        │ │
│  │                                                                │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ D1 Database                                                   │ │
│  │                                                                │ │
│  │  Contains ONLY:                                                │ │
│  │  - Encrypted blobs (AES-256-GCM)                              │ │
│  │  - HMAC hashes (for lookups)                                   │ │
│  │  - SHA-256 hashes (API keys)                                   │ │
│  │  - Non-sensitive metadata (timestamps, UUIDs, types)           │ │
│  │                                                                │ │
│  │  A full database dump reveals NOTHING about secret contents.   │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Single Point of Failure: The Master Key

This is an intentional design tradeoff:

**If the master key is lost**, all encrypted data in D1 is permanently unrecoverable. There is no backdoor, no recovery mechanism.

**Mitigations:**
- The key is managed by Cloudflare's Worker Secrets infrastructure (encrypted at rest, access-controlled)
- Users should back up the master key in a separate secure location (e.g., a password manager, hardware security module, or printed in a safe)
- The `kfl init` command will clearly warn about this and prompt the user to save the key

**If the master key is compromised**, an attacker with both the key and DB access can decrypt everything. However:
- DB access alone is not enough
- Key alone is not enough (need DB access)
- Both are needed simultaneously

---

Next: [API Key & Access Control →](./03-api-keys-and-access.md)
