import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

// ─── Local SQLite discovery ───────────────────────────────────────────────────
//
// wrangler dev persists the local D1 database as a SQLite file under:
//   .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite
//
// We glob-find it at config-load time so Drizzle Studio can open it directly
// without needing a running wrangler process.

function findLocalD1(): string {
  const base = path.resolve(__dirname, ".wrangler/state/v3/d1");
  try {
    const files = fs.readdirSync(base, { recursive: true, encoding: "utf-8" });
    const sqlite = files.find((f) => f.endsWith(".sqlite"));
    if (!sqlite) {
      throw new Error(
        `No .sqlite file found under ${base}.\n` +
          `Run "npm run dev" (wrangler dev) at least once to create the local D1 database.`
      );
    }
    return path.resolve(base, sqlite);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(
        `Local D1 state directory not found (${base}).\n` +
          `Run "npm run dev" (wrangler dev) at least once to create the local D1 database.`
      );
    }
    throw err;
  }
}

// ─── Remote D1 (d1-http driver) ──────────────────────────────────────────────
//
// Set these env vars to connect Drizzle Studio / drizzle-kit to the remote D1:
//
//   DRIZZLE_REMOTE=true
//   CLOUDFLARE_ACCOUNT_ID=<your-account-id>
//   CLOUDFLARE_D1_DATABASE_ID=<your-database-id>
//   CLOUDFLARE_D1_TOKEN=<api-token-with-D1-read-permissions>
//
// The database_id is printed during `kfl init`, or find it in the Cloudflare
// dashboard under Workers & Pages → D1 → keyflare-db.

const isRemote =
  process.env.DRIZZLE_REMOTE === "true" &&
  process.env.CLOUDFLARE_ACCOUNT_ID &&
  process.env.CLOUDFLARE_D1_DATABASE_ID &&
  process.env.CLOUDFLARE_D1_TOKEN;

export default defineConfig({
  out: "./migrations",
  schema: "./src/db/schema.ts",
  dialect: "sqlite",
  ...(isRemote
    ? {
        driver: "d1-http" as const,
        dbCredentials: {
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
          databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID!,
          token: process.env.CLOUDFLARE_D1_TOKEN!,
        },
      }
    : {
        dbCredentials: {
          url: findLocalD1(),
        },
      }),
});
