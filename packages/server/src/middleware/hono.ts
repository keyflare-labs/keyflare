import { createMiddleware } from "hono/factory";
import { drizzle } from "drizzle-orm/d1";
import { deriveMasterKeys } from "../crypto/keys.js";
import { authenticate } from "./auth.js";
import type { AppEnv } from "../types.js";
import { jsonError } from "../utils.js";

/** Injects D1 db and derived keys into context. Use for all routes except /health. */
export const dbAndKeysMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const db = drizzle(c.env.DB_BINDING);
  const derivedKeys = await deriveMasterKeys(c.env.MASTER_KEY);
  c.set("db", db);
  c.set("derivedKeys", derivedKeys);
  await next();
});

/** Requires auth; sets c.env.auth or returns 401. Requires dbAndKeysMiddleware to run first. */
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const db = c.get("db");
  const derivedKeys = c.get("derivedKeys");
  const auth = await authenticate(c.req.raw, db, derivedKeys);
  if (!auth) {
    return jsonError("UNAUTHORIZED", "Invalid or missing API key", 401);
  }
  c.set("auth", auth);
  await next();
});
