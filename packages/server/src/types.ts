import type { KeyType, Permission, KeyScope, Logger } from "@keyflare/shared";
import type { DrizzleD1Database } from "drizzle-orm/d1";

/** Worker bindings (DB, MASTER_KEY) — mirrors Cloudflare.Env from worker-configuration.d.ts. */
export interface Env {
  DB: D1Database;
  MASTER_KEY: string;
}

/** Authenticated key context passed to route handlers */
export interface AuthContext {
  keyId: string;
  keyType: KeyType;
  permissions: Permission | "full";
  scopes: KeyScope[] | null;   // decrypted scopes; null for user keys
}

/** Derived crypto keys for use in request handlers */
export interface DerivedKeys {
  encryptionKey: CryptoKey;
  hmacKey: CryptoKey;
}

/** Hono app generic: Bindings from Worker env, Variables from middleware */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    db: DrizzleD1Database;
    derivedKeys: DerivedKeys;
    auth: AuthContext;
    logger: Logger;
  };
};
