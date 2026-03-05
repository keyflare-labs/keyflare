import {
  USER_KEY_PREFIX,
  KEY_RANDOM_HEX_LENGTH,
  KEY_PREFIX_LENGTH,
} from "@keyflare/shared";
import type { BootstrapResponse } from "@keyflare/shared";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { sha256 } from "../crypto/hash.js";
import { encrypt } from "../crypto/encrypt.js";
import { countKeys, insertKey } from "../db/queries.js";
import type { DerivedKeys } from "../types.js";
import { jsonOk, jsonError } from "../utils.js";

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

  // Generate a user key
  const randomHex = generateRandomHex(KEY_RANDOM_HEX_LENGTH);
  const fullKey = `${USER_KEY_PREFIX}${randomHex}`;
  const prefix = fullKey.slice(0, KEY_PREFIX_LENGTH);
  const keyHash = await sha256(fullKey);

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
    createdAt: new Date().toISOString(),
  });

  return jsonOk<BootstrapResponse>({
    key: fullKey,
    prefix,
    type: "user",
    label,
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
