import {
  USER_KEY_PREFIX,
  SYSTEM_KEY_PREFIX,
  KEY_RANDOM_HEX_LENGTH,
  KEY_PREFIX_LENGTH,
} from "@keyflare/shared";
import type {
  CreateKeyResponse,
  ListKeysResponse,
  KeyInfo,
  RevokeKeyResponse,
  UpdateKeyResponse,
} from "@keyflare/shared";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { sha256 } from "../crypto/hash.js";
import { encrypt, decrypt } from "../crypto/encrypt.js";
import { insertKey, listKeys, revokeKeyByPrefix, getKeyByPrefix, updateKeyScopes, prefixExists } from "../db/queries.js";
import type { AuthContext, DerivedKeys } from "../types.js";
import { jsonOk, jsonError } from "../utils.js";
import type { CreateKeyInput, UpdateKeyInput } from "../validation/schemas.js";

export async function handleCreateKey(
  _request: Request,
  db: DrizzleD1Database,
  auth: AuthContext,
  derivedKeys: DerivedKeys,
  body: CreateKeyInput
): Promise<Response> {
  if (!auth || auth.keyType !== "user") {
    return jsonError("FORBIDDEN", "Only user keys can create API keys", 403);
  }

  const prefix_str =
    body.type === "user" ? USER_KEY_PREFIX : SYSTEM_KEY_PREFIX;

  const generated = await generateUniqueKey(db, prefix_str);
  if (generated === null) {
    return jsonError(
      "INTERNAL_ERROR",
      "Unable to generate a unique key prefix after multiple attempts. Please try again.",
      500
    );
  }
  const { fullKey, keyPrefix, keyHash } = generated;

  const encryptedLabel = await encrypt(derivedKeys.encryptionKey, body.label);

  let encryptedScopes: string | null = null;
  if (body.type === "system" && body.scopes) {
    const normalizedScopes = body.scopes.map(s => ({
      project: s.project.toLowerCase(),
      environment: s.environment.toLowerCase()
    }));
    encryptedScopes = await encrypt(
      derivedKeys.encryptionKey,
      JSON.stringify(normalizedScopes)
    );
  }

  const permissions =
    body.type === "user" ? "full" : (body.permission ?? "read");

  const userEmail = body.user_email ?? null;

  await insertKey(db, {
    id: crypto.randomUUID(),
    keyPrefix,
    keyHash,
    type: body.type,
    label: encryptedLabel,
    scopes: encryptedScopes,
    permissions,
    userEmail,
    createdAt: new Date().toISOString(),
  });

  return jsonOk<CreateKeyResponse>({
    key: fullKey,
    prefix: keyPrefix,
    type: body.type,
    label: body.label,
    scopes: body.scopes?.map(s => ({ project: s.project.toLowerCase(), environment: s.environment.toLowerCase() })) ?? null,
    permission: permissions,
    user_email: userEmail,
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
      user_email: row.userEmail ?? null,
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

export async function handleUpdateKey(
  _request: Request,
  db: DrizzleD1Database,
  auth: AuthContext,
  derivedKeys: DerivedKeys,
  prefix: string,
  body: UpdateKeyInput
): Promise<Response> {
  if (!auth || auth.keyType !== "user") {
    return jsonError("FORBIDDEN", "Only user keys can update API keys", 403);
  }

  // Fetch the existing key
  const existingKey = await getKeyByPrefix(db, prefix);
  if (!existingKey) {
    return jsonError("NOT_FOUND", `Key with prefix "${prefix}" not found`, 404);
  }
  if (existingKey.revoked === 1) {
    return jsonError("BAD_REQUEST", `Key "${prefix}" is revoked`, 400);
  }
  if (existingKey.type === "user") {
    return jsonError(
      "BAD_REQUEST",
      "User keys cannot have their scopes updated (they have full access)",
      400
    );
  }

  // Encrypt the new scopes
  const normalizedScopes = body.scopes.map(s => ({
    project: s.project.toLowerCase(),
    environment: s.environment.toLowerCase()
  }));
  const encryptedScopes = await encrypt(
    derivedKeys.encryptionKey,
    JSON.stringify(normalizedScopes)
  );

  // Update the key
  const updated = await updateKeyScopes(db, prefix, encryptedScopes, body.permission);
  if (!updated) {
    return jsonError("INTERNAL_ERROR", "Failed to update key", 500);
  }

  // Decrypt label for response
  let label = "";
  if (existingKey.label) {
    try {
      label = await decrypt(derivedKeys.encryptionKey, existingKey.label);
    } catch {
      label = "(decryption failed)";
    }
  }

  return jsonOk<UpdateKeyResponse>({
    prefix,
    type: existingKey.type as "user" | "system",
    label,
    scopes: normalizedScopes,
    permission: body.permission,
  });
}

function generateRandomHex(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length / 2));
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Generate a key with a unique prefix by retrying up to MAX_RETRIES times.
 * Returns null if all attempts are exhausted (should be extremely rare in practice).
 */
export async function generateUniqueKey(
  db: DrizzleD1Database,
  prefix_str: string
): Promise<{ fullKey: string; keyPrefix: string; keyHash: string } | null> {
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const randomHex = generateRandomHex(KEY_RANDOM_HEX_LENGTH);
    const fullKey = `${prefix_str}${randomHex}`;
    const keyPrefix = fullKey.slice(0, KEY_PREFIX_LENGTH);
    if (!(await prefixExists(db, keyPrefix))) {
      return { fullKey, keyPrefix, keyHash: await sha256(fullKey) };
    }
  }
  return null;
}
