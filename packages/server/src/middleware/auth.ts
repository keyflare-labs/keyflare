import type { KeyScope } from "@keyflare/shared";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { sha256 } from "../crypto/hash.js";
import { decrypt } from "../crypto/encrypt.js";
import { getKeyByHash, updateKeyLastUsed } from "../db/queries.js";
import type { AuthContext, DerivedKeys } from "../types.js";

/**
 * Authenticate a request by extracting and verifying the API key.
 * Returns null if authentication fails.
 */
export async function authenticate(
  request: Request,
  db: DrizzleD1Database,
  derivedKeys: DerivedKeys
): Promise<AuthContext | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const apiKey = authHeader.slice(7).trim();
  if (!apiKey) return null;

  const keyHash = await sha256(apiKey);
  const row = await getKeyByHash(db, keyHash);
  if (!row) return null;

  // Update last used
  await updateKeyLastUsed(db, row.id).catch(() => {});

  if (row.type === "user") {
    return {
      keyId: row.id,
      keyType: "user",
      permissions: "full",
      scopes: null,
    };
  }

  // System key — decrypt scopes
  let scopes: KeyScope[] | null = null;
  if (row.scopes) {
    try {
      const decryptedScopes = await decrypt(
        derivedKeys.encryptionKey,
        row.scopes
      );
      scopes = JSON.parse(decryptedScopes);
    } catch {
      return null; // corrupted scopes = deny
    }
  }

  return {
    keyId: row.id,
    keyType: "system",
    permissions: row.permissions as "read" | "readwrite",
    scopes,
  };
}

/**
 * Check if a system key's scopes allow access to a specific project/environment.
 */
export function hasScope(
  auth: AuthContext,
  project: string,
  environment: string
): boolean {
  if (auth.keyType === "user") return true;
  if (!auth.scopes) return false;

  const projectLower = project.toLowerCase();
  const environmentLower = environment.toLowerCase();

  return auth.scopes.some(
    (s) =>
      s.project.toLowerCase() === projectLower &&
      (s.environment.toLowerCase() === "*" || s.environment.toLowerCase() === environmentLower)
  );
}

/**
 * Check if the auth context allows write operations.
 */
export function canWrite(auth: AuthContext): boolean {
  return auth.permissions === "full" || auth.permissions === "readwrite";
}

/**
 * Check if the auth context is a user key (god mode).
 */
export function isUserKey(auth: AuthContext): boolean {
  return auth.keyType === "user";
}
