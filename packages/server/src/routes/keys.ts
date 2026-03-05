import {
  USER_KEY_PREFIX,
  SYSTEM_KEY_PREFIX,
  KEY_RANDOM_HEX_LENGTH,
  KEY_PREFIX_LENGTH,
} from "@keyflare/shared";
import type {
  CreateKeyRequest,
  CreateKeyResponse,
  ListKeysResponse,
  KeyInfo,
  RevokeKeyResponse,
} from "@keyflare/shared";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { sha256 } from "../crypto/hash.js";
import { encrypt, decrypt } from "../crypto/encrypt.js";
import { insertKey, listKeys, revokeKeyByPrefix } from "../db/queries.js";
import type { AuthContext, DerivedKeys } from "../types.js";
import { jsonOk, jsonError, parseJsonBody } from "../utils.js";

export async function handleCreateKey(
  request: Request,
  db: DrizzleD1Database,
  auth: AuthContext,
  derivedKeys: DerivedKeys
): Promise<Response> {
  if (!auth || auth.keyType !== "user") {
    return jsonError("FORBIDDEN", "Only user keys can create API keys", 403);
  }

  const body = await parseJsonBody<CreateKeyRequest>(request);
  if (!body || !body.type || !body.label) {
    return jsonError("BAD_REQUEST", "Missing required fields: type, label", 400);
  }

  if (body.type === "system") {
    if (!body.scopes || body.scopes.length === 0) {
      return jsonError(
        "BAD_REQUEST",
        "System keys require at least one scope",
        400
      );
    }
    if (!body.permission || !["read", "readwrite"].includes(body.permission)) {
      return jsonError(
        "BAD_REQUEST",
        "System keys require permission: 'read' or 'readwrite'",
        400
      );
    }
  }

  const prefix_str =
    body.type === "user" ? USER_KEY_PREFIX : SYSTEM_KEY_PREFIX;
  const randomHex = generateRandomHex(KEY_RANDOM_HEX_LENGTH);
  const fullKey = `${prefix_str}${randomHex}`;
  const keyPrefix = fullKey.slice(0, KEY_PREFIX_LENGTH);
  const keyHash = await sha256(fullKey);

  const encryptedLabel = await encrypt(derivedKeys.encryptionKey, body.label);

  let encryptedScopes: string | null = null;
  if (body.type === "system" && body.scopes) {
    encryptedScopes = await encrypt(
      derivedKeys.encryptionKey,
      JSON.stringify(body.scopes)
    );
  }

  const permissions =
    body.type === "user" ? "full" : (body.permission ?? "read");

  await insertKey(db, {
    id: crypto.randomUUID(),
    keyPrefix,
    keyHash,
    type: body.type,
    label: encryptedLabel,
    scopes: encryptedScopes,
    permissions,
    createdAt: new Date().toISOString(),
  });

  return jsonOk<CreateKeyResponse>({
    key: fullKey,
    prefix: keyPrefix,
    type: body.type,
    label: body.label,
    scopes: body.scopes ?? null,
    permission: permissions,
  });
}

export async function handleListKeys(
  request: Request,
  db: DrizzleD1Database,
  auth: AuthContext,
  derivedKeys: DerivedKeys
): Promise<Response> {
  if (!auth || auth.keyType !== "user") {
    return jsonError("FORBIDDEN", "Only user keys can list API keys", 403);
  }

  const rows = await listKeys(db);
  const keys: KeyInfo[] = [];

  for (const row of rows) {
    let label = "";
    if (row.label) {
      try {
        label = await decrypt(derivedKeys.encryptionKey, row.label);
      } catch {
        label = "(decryption failed)";
      }
    }

    let scopes = null;
    if (row.scopes) {
      try {
        const decrypted = await decrypt(derivedKeys.encryptionKey, row.scopes);
        scopes = JSON.parse(decrypted);
      } catch {
        scopes = null;
      }
    }

    keys.push({
      id: row.id,
      prefix: row.keyPrefix,
      type: row.type,
      label,
      scopes,
      permission: row.permissions,
      created_at: row.createdAt,
      last_used_at: row.lastUsedAt,
      revoked: row.revoked === 1,
    });
  }

  return jsonOk<ListKeysResponse>({ keys });
}

export async function handleRevokeKey(
  request: Request,
  db: DrizzleD1Database,
  auth: AuthContext,
  prefix: string
): Promise<Response> {
  if (!auth || auth.keyType !== "user") {
    return jsonError("FORBIDDEN", "Only user keys can revoke API keys", 403);
  }

  const revoked = await revokeKeyByPrefix(db, prefix);
  if (!revoked) {
    return jsonError("NOT_FOUND", `Key with prefix "${prefix}" not found or already revoked`, 404);
  }

  return jsonOk<RevokeKeyResponse>({ revoked: prefix });
}

function generateRandomHex(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length / 2));
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}
