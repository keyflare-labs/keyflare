# Keyflare — API Reference

## Base URL

```
https://keyflare.<your-account>.workers.dev
```

## Authentication

All endpoints (except `/bootstrap`) require an API key in the `Authorization` header:

```
Authorization: Bearer kfl_user_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
```

## Common Response Format

```json
{
  "ok": true,
  "data": { ... }
}
```

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Project not found"
  }
}
```

## Error Codes

| HTTP Status | Code | Description |
|------------|------|-------------|
| 400 | `BAD_REQUEST` | Invalid request body or parameters |
| 401 | `UNAUTHORIZED` | Missing, invalid, or revoked API key |
| 403 | `FORBIDDEN` | Key doesn't have required scope/permission |
| 404 | `NOT_FOUND` | Resource doesn't exist |
| 409 | `CONFLICT` | Resource already exists / bootstrap already done |
| 500 | `INTERNAL_ERROR` | Server error |

---

## Endpoints

### `POST /bootstrap`

Create the first user API key. Only works when no keys exist in the database.

**Auth:** None (one-time, unauthenticated)

**Request:** *(no body)*

**Response:**
```json
{
  "ok": true,
  "data": {
    "key": "kfl_user_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    "prefix": "kfl_user_a1b2",
    "type": "user",
    "label": "bootstrap"
  }
}
```

---

### `POST /keys`

Create a new API key.

**Auth:** User key required

**Request:**
```json
{
  "type": "user" | "system",
  "label": "my-ci-key",
  "scopes": [                              // Required for system keys
    { "project": "my-api", "environment": "production" },
    { "project": "my-api", "environment": "*" }
  ],
  "permission": "read" | "readwrite"        // Required for system keys
}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "key": "kfl_sys_b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7",
    "prefix": "kfl_sys_b2c3",
    "type": "system",
    "label": "my-ci-key",
    "scopes": [
      { "project": "my-api", "environment": "production" }
    ],
    "permission": "read"
  }
}
```

> ⚠️ The full `key` is returned **only in this response**. It cannot be retrieved again.

---

### `GET /keys`

List all API keys.

**Auth:** User key required

**Response:**
```json
{
  "ok": true,
  "data": {
    "keys": [
      {
        "id": "uuid",
        "prefix": "kfl_user_a1b2",
        "type": "user",
        "label": "bootstrap",
        "scopes": null,
        "permission": "full",
        "created_at": "2024-01-15T10:00:00Z",
        "last_used_at": "2024-01-18T14:30:00Z",
        "revoked": false
      }
    ]
  }
}
```

---

### `DELETE /keys/:prefix`

Revoke an API key.

**Auth:** User key required

**Response:**
```json
{
  "ok": true,
  "data": { "revoked": "kfl_sys_b2c3" }
}
```

---

### `POST /projects`

Create a new project.

**Auth:** User key required

**Request:**
```json
{
  "name": "my-api"
}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "name": "my-api",
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

---

### `GET /projects`

List all projects.

**Auth:** User key required (system keys see only their scoped projects)

**Response:**
```json
{
  "ok": true,
  "data": {
    "projects": [
      {
        "id": "uuid",
        "name": "my-api",
        "environment_count": 3,
        "created_at": "2024-01-15T10:00:00Z"
      }
    ]
  }
}
```

---

### `DELETE /projects/:name`

Delete a project and all its environments and secrets.

**Auth:** User key required

**Response:**
```json
{
  "ok": true,
  "data": {
    "deleted": "my-api",
    "environments_removed": 3,
    "secrets_removed": 42
  }
}
```

---

### `POST /projects/:project/configs`

Create a new environment/config within a project.

**Auth:** User key required

**Request:**
```json
{
  "name": "production"
}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "name": "production",
    "project": "my-api",
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

---

### `GET /projects/:project/configs`

List all environments/configs in a project.

**Auth:** User key or scoped system key

**Response:**
```json
{
  "ok": true,
  "data": {
    "configs": [
      {
        "id": "uuid",
        "name": "production",
        "secret_count": 15,
        "created_at": "2024-01-15T10:00:00Z"
      }
    ]
  }
}
```

---

### `DELETE /projects/:project/configs/:config`

Delete an environment and all its secrets.

**Auth:** User key required

---

### `GET /projects/:project/configs/:config/secrets`

Get all secrets for a config. Returns decrypted key-value pairs.

**Auth:** User key or scoped system key (with read permission)

**Response:**
```json
{
  "ok": true,
  "data": {
    "secrets": {
      "DATABASE_URL": "postgres://user:pass@host:5432/db",
      "REDIS_URL": "redis://localhost:6379",
      "API_SECRET": "sk_live_abc123"
    }
  }
}
```

---

### `PUT /projects/:project/configs/:config/secrets`

Set secrets for a config. **Full override** — replaces all existing secrets.

**Auth:** User key or scoped system key (with readwrite permission)

**Request:**
```json
{
  "secrets": {
    "DATABASE_URL": "postgres://user:pass@host:5432/db",
    "REDIS_URL": "redis://localhost:6379",
    "API_SECRET": "sk_live_abc123"
  }
}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "count": 3,
    "project": "my-api",
    "config": "production"
  }
}
```

---

### `PATCH /projects/:project/configs/:config/secrets`

Update specific secrets without affecting others. Sets or overwrites only the provided keys.

**Auth:** User key or scoped system key (with readwrite permission)

**Request:**
```json
{
  "set": {
    "NEW_KEY": "new-value",
    "EXISTING_KEY": "updated-value"
  },
  "delete": ["OLD_KEY"]
}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "set": 2,
    "deleted": 1,
    "total": 16
  }
}
```

---

## Rate Limits

Cloudflare Workers have built-in rate limiting. For additional protection:

| Key Type | Rate Limit |
|----------|-----------|
| User key | 100 req/min |
| System key | 300 req/min |

Exceeded limits return `429 Too Many Requests`.

---

Next: [Development Guide →](./06-development.md)
