import { USER_KEY_PREFIX } from "@keyflare/shared";
import type { BootstrapResponse, BootstrapStatusResponse } from "@keyflare/shared";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { encrypt } from "../crypto/encrypt.js";
import { countKeys, insertKey } from "../db/queries.js";
import type { DerivedKeys } from "../types.js";
import { jsonOk, jsonError } from "../utils.js";
import { generateUniqueKey } from "./keys.js";

export async function handleBootstrapStatus(
  request: Request,
  db: DrizzleD1Database
): Promise<Response> {
  if (request.method !== "GET") {
    return jsonError("BAD_REQUEST", "Method not allowed", 405);
  }

  const existing = await countKeys(db);
  return jsonOk<BootstrapStatusResponse>({ initialized: existing > 0 });
}

export async function handleBootstrap(
  request: Request,
  db: DrizzleD1Database,
  derivedKeys: DerivedKeys
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonError("BAD_REQUEST", "Method not allowed", 405);
  }

  // Only allow bootstrap when no keys exist
  const existing = await countKeys(db);
  if (existing > 0) {
    return jsonError(
      "CONFLICT",
      "Bootstrap already completed. API keys already exist.",
      409
    );
  }

  // Parse optional body for user_email
  let userEmail: string | null = null;
  try {
    const body = (await request.json()) as { user_email?: string };
    if (body.user_email && typeof body.user_email === "string") {
      userEmail = body.user_email;
    }
  } catch {
    // No body or invalid JSON — that's fine, user_email stays null
  }

  // Generate a user key with a unique prefix
  const generated = await generateUniqueKey(db, USER_KEY_PREFIX);
  if (generated === null) {
    return jsonError(
      "INTERNAL_ERROR",
      "Unable to generate a unique key prefix after multiple attempts. Please try again.",
      500
    );
  }
  const { fullKey, keyPrefix: prefix, keyHash } = generated;

  const label = "bootstrap";
  const encryptedLabel = await encrypt(derivedKeys.encryptionKey, label);

  await insertKey(db, {
    id: crypto.randomUUID(),
    keyPrefix: prefix,
    keyHash: keyHash,
    type: "user",
    label: encryptedLabel,
    scopes: null,
    permissions: "full",
    userEmail,
    createdAt: new Date().toISOString(),
  });

  return jsonOk<BootstrapResponse>({
    key: fullKey,
    prefix,
    type: "user",
    label,
    user_email: userEmail,
  });
}


