import type { Env } from "../src/types.js";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: Array<{ id: number; name: string; queries: string[] }>;
  }
}
