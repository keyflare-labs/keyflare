# Keyflare — Flow Diagrams

All diagrams use [Mermaid](https://mermaid.js.org/) syntax and render natively on GitHub.

---

## 1. System Overview

```mermaid
graph TB
    subgraph Clients
        CLI[kfl CLI]
        CI[CI/CD Pipeline]
        APP[Application Runtime]
    end

    subgraph Cloudflare Edge
        W[Keyflare Worker]
        S[(MASTER_KEY<br/>Worker Secret)]
        D[(D1 Database<br/>Encrypted Data)]
    end

    CLI -->|HTTPS + API Key| W
    CI -->|HTTPS + System Key| W
    APP -->|HTTPS + System Key| W

    W --- S
    W -->|Read/Write<br/>Encrypted| D
```

---

## 2. Encryption Flow — Writing a Secret

```mermaid
sequenceDiagram
    participant C as CLI
    participant W as Worker
    participant K as MASTER_KEY
    participant D as D1

    C->>W: PUT /secrets { "DB_URL": "postgres://..." }
    W->>W: Verify API key (SHA-256 hash lookup)

    Note over W,K: Key Derivation
    W->>K: HKDF(MASTER_KEY, info="encrypt") → enc_key
    W->>K: HKDF(MASTER_KEY, info="hmac") → hmac_key

    Note over W: Encrypt secret key
    W->>W: AES-256-GCM(enc_key, "DB_URL") → encrypted_key

    Note over W: Hash key for lookups
    W->>W: HMAC-SHA256(hmac_key, "DB_URL") → key_hash

    Note over W: Encrypt secret value
    W->>W: AES-256-GCM(enc_key, "postgres://...") → encrypted_value

    W->>D: INSERT (key_encrypted, key_hash, value_encrypted)
    D-->>W: OK
    W-->>C: { "ok": true }
```

---

## 3. Encryption Flow — Reading Secrets

```mermaid
sequenceDiagram
    participant C as CLI
    participant W as Worker
    participant K as MASTER_KEY
    participant D as D1

    C->>W: GET /secrets?project=my-api&config=production
    W->>W: Verify API key + check scopes

    W->>K: HKDF(MASTER_KEY, info="hmac") → hmac_key
    W->>W: HMAC-SHA256(hmac_key, "my-api") → project_hash
    W->>W: HMAC-SHA256(hmac_key, "production") → config_hash

    W->>D: SELECT * WHERE project_hash=? AND env_hash=?
    D-->>W: [encrypted rows]

    W->>K: HKDF(MASTER_KEY, info="encrypt") → enc_key

    loop For each secret row
        W->>W: AES-256-GCM.decrypt(enc_key, row.key_encrypted) → key
        W->>W: AES-256-GCM.decrypt(enc_key, row.value_encrypted) → value
    end

    W-->>C: { "secrets": { "DB_URL": "postgres://...", ... } }
```

---

## 4. API Key Authentication Flow

```mermaid
flowchart TD
    A[Request arrives] --> B{Has Authorization header?}
    B -->|No| Z1[401 Unauthorized]
    B -->|Yes| C[Extract Bearer token]

    C --> D[SHA-256 hash the token]
    D --> E{Hash found in api_keys?}
    E -->|No| Z1

    E -->|Yes| F{Key revoked?}
    F -->|Yes| Z1

    F -->|No| G{Key type?}

    G -->|user| H[Full access ✓]

    G -->|system| I{Decrypt scopes}
    I --> J{Requested resource<br/>matches a scope?}
    J -->|No| Z2[403 Forbidden]
    J -->|Yes| K{Operation allowed<br/>by permission level?}
    K -->|No| Z2
    K -->|Yes| L[Authorized ✓]
```

---

## 5. Bootstrap Flow

```mermaid
sequenceDiagram
    participant U as User
    participant CLI as kfl init
    participant CF as Cloudflare API
    participant W as Keyflare Worker
    participant D as D1

    U->>CLI: kfl init
    CLI->>U: Prompt for CF API token
    U->>CLI: <token>

    CLI->>CF: Verify token
    CF-->>CLI: ✓ Account confirmed

    CLI->>CF: wrangler d1 create keyflare-db
    CF-->>CLI: database_id: abc123

    CLI->>CLI: Generate MASTER_KEY (256-bit random)
    CLI->>U: ⚠️ Save this master key!

    CLI->>CF: wrangler deploy (Worker + D1 binding)
    CF-->>CLI: ✓ Deployed

    CLI->>CF: wrangler secret put MASTER_KEY
    CF-->>CLI: ✓ Secret stored

    CLI->>W: Run migrations (create tables)
    W->>D: CREATE TABLE ...
    D-->>W: ✓

    CLI->>W: POST /bootstrap
    W->>W: Check: any keys exist? → No
    W->>W: Generate kfl_user_<random>
    W->>W: SHA-256(key) → key_hash
    W->>D: INSERT api_key (hash, type=user, label=bootstrap)
    W-->>CLI: { key: "kfl_user_a1b2..." }

    CLI->>U: Your root API key: kfl_user_a1b2...
    CLI->>CLI: Save to ~/.config/keyflare/
```

---

## 6. `kfl run` — Command Injection Flow

```mermaid
sequenceDiagram
    participant U as User
    participant CLI as kfl run
    participant W as Keyflare API
    participant P as Child Process

    U->>CLI: kfl run --project my-api --config prod -- npm run build

    CLI->>W: GET /projects/my-api/configs/prod/secrets
    Note over CLI,W: Authorization: Bearer kfl_sys_...
    W-->>CLI: { "DB_URL": "...", "API_KEY": "...", ... }

    CLI->>CLI: Build environment variables map
    CLI->>P: spawn("npm", ["run", "build"], { env: secrets + process.env })

    Note over P: Process runs with secrets<br/>as env vars (in-memory only)

    P-->>CLI: Exit code
    CLI-->>U: Exit code (passthrough)
```

---

## 7. Data Model (Entity Relationship)

```mermaid
erDiagram
    API_KEYS {
        text id PK
        text key_prefix
        text key_hash UK
        text type "user | system"
        text label "(encrypted)"
        text scopes "(encrypted JSON, nullable)"
        text permissions "read | readwrite"
        text created_at
        text last_used_at
        int revoked "0 | 1"
    }

    PROJECTS {
        text id PK
        text name_encrypted
        text name_hash UK
        text created_at
    }

    ENVIRONMENTS {
        text id PK
        text project_id FK
        text name_encrypted
        text name_hash
        text created_at
    }

    SECRETS {
        text id PK
        text environment_id FK
        text key_encrypted
        text key_hash
        text value_encrypted
        text updated_at
    }

    PROJECTS ||--o{ ENVIRONMENTS : has
    ENVIRONMENTS ||--o{ SECRETS : contains
```

---

## 8. Security Layers

```mermaid
graph TB
    subgraph "Layer 1: Transport"
        TLS[TLS 1.3 / HTTPS<br/>Cloudflare Edge]
    end

    subgraph "Layer 2: Authentication"
        AUTH[API Key Verification<br/>SHA-256 hash comparison]
    end

    subgraph "Layer 3: Authorization"
        SCOPE[Scope Checking<br/>Project + Environment matching]
        PERM[Permission Checking<br/>read vs readwrite vs full]
    end

    subgraph "Layer 4: Encryption at Rest"
        ENC[AES-256-GCM<br/>All data encrypted in D1]
        HMAC[HMAC-SHA256<br/>Keyed hashes for lookups]
    end

    subgraph "Layer 5: Key Management"
        MK[MASTER_KEY<br/>Cloudflare Worker Secret<br/>Single root of trust]
        HKDF[HKDF Key Derivation<br/>Separate keys for encrypt + HMAC]
    end

    TLS --> AUTH --> SCOPE --> PERM --> ENC
    MK --> HKDF --> ENC
    MK --> HKDF --> HMAC
```

---

## 9. Secret Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Created: kfl secrets set / kfl upload
    Created --> Encrypted: AES-256-GCM(MASTER_KEY)
    Encrypted --> StoredInD1: INSERT/UPDATE in D1
    StoredInD1 --> Fetched: GET request + auth
    Fetched --> Decrypted: AES-256-GCM.decrypt(MASTER_KEY)
    Decrypted --> Returned: JSON response
    Returned --> Injected: kfl run (env vars)
    Returned --> Written: kfl download (file)
    StoredInD1 --> Deleted: kfl secrets delete / override
    Deleted --> [*]
```
