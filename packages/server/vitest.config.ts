import path from "node:path";
import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";
import { TEST_WRANGLER_DIR } from "./test/global-setup.js";

export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(__dirname, "migrations");
  const migrations = await readD1Migrations(migrationsPath);

  return {
    test: {
      // Run global-setup.ts before any tests — creates the temp dir and
      // returns a teardown that deletes it after the suite finishes.
      globalSetup: ["./test/global-setup.ts"],

      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.toml" },
          miniflare: {
            // Persist D1 state to the isolated temp dir, not .wrangler/
            d1Persist: TEST_WRANGLER_DIR,
            bindings: {
              TEST_MIGRATIONS: migrations,
              MASTER_KEY: "keyflare-test-master-key-not-for-production",
            },
          },
        },
      },
    },
  };
});
