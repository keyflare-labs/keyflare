import type { KeyType, Permission, KeyScope, Logger } from "@keyflare/shared";
import type { DrizzleD1Database } from "drizzle-orm/d1";

/** Worker bindings (DB_BINDING, MASTER_KEY) — from worker-configuration.d.ts (wrangler types). */
export type Env = Cloudflare.Env;

/** Authenticated key context passed to route handlers */
export interface AuthContext {
  keyId: string;
  keyType: KeyType;
  permissions: Permission | "full";
  scopes: KeyScope[] | null; // decrypted scopes; null for user keys
}

/** Derived crypto keys for use in request handlers */
export interface DerivedKeys {
  encryptionKey: CryptoKey;
  hmacKey: CryptoKey;
}

/** Hono app generic: Bindings from Worker env (worker-configuration.d.ts), Variables from middleware */
export type AppEnv = {
  Bindings: Cloudflare.Env;
  Variables: {
    db: DrizzleD1Database;
    derivedKeys: DerivedKeys;
    auth: AuthContext;
    logger: Logger;
  };
};
