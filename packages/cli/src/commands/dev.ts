/**
 * kfl dev — local development helpers
 *
 * `kfl dev server`  — starts wrangler dev locally (port 8787)
 * `kfl dev init`    — generates a local MASTER_KEY, applies migrations,
 *                     bootstraps, and saves credentials pointing at localhost
 *
 * No Cloudflare account needed. Everything runs via Miniflare/wrangler.
 *
 * Set KEYFLARE_LOCAL=true (or just use http://localhost as the API URL) to
 * activate local mode in other CLI commands.
 */

import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ora from "ora";
import type { BootstrapResponse } from "@keyflare/shared";
import { api, KeyflareApiError } from "../api/client.js";
import { writeConfig, writeApiKey } from "../config.js";
import { makeDebug, redact } from "../debug.js";
import { log, warn, bold, dim } from "../output/log.js";

const LOCAL_API_URL = "http://localhost:8787";
const debug = makeDebug("dev");

/** Path to packages/server relative to this compiled CLI file */
function serverDir(): string {
  // __dirname in ESM is not available, use import.meta.url
  const here = new URL(".", import.meta.url).pathname;
  // When built: packages/cli/dist/commands/dev.js → ../../server
  // When running via tsx: packages/cli/src/commands/dev.ts → ../../server
  const dir = path.resolve(here, "../../../server");
  debug("resolved serverDir=%s", dir);
  return dir;
}

function devVarsPath(): string {
  return path.join(serverDir(), ".dev.vars");
}

function generateLocalMasterKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}

/**
 * Write (or overwrite) the .dev.vars file with a fresh MASTER_KEY.
 * Returns the key that was written.
 */
function ensureDevVars(force = false): string {
  debug("ensureDevVars force=%s", force);
  const devVars = devVarsPath();
  if (!force && fs.existsSync(devVars)) {
    // Already exists — extract the key
    const existing = fs.readFileSync(devVars, "utf8");
    const match = existing.match(/^MASTER_KEY=(.+)$/m);
    if (match) {
      debug("reusing existing local master key (%s)", redact(match[1].trim()));
      return match[1].trim();
    }
  }
  const key = generateLocalMasterKey();
  debug("generated local master key (%s)", redact(key));
  fs.writeFileSync(devVars, `MASTER_KEY=${key}\n`, "utf8");
  return key;
}

/**
 * Apply D1 migrations locally using wrangler.
 */
function applyLocalMigrations() {
  debug("applying local migrations via keyflare");
  const result = spawnSync(
    "npx",
    ["wrangler", "d1", "migrations", "apply", "keyflare", "--local"],
    {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: serverDir(),
      env: { ...process.env },
    }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr?.toString() ?? "migration failed");
  }
  debug("local migrations applied");
}

/**
 * `kfl dev server` — Start the local Keyflare server via wrangler dev.
 * Blocks until the user kills it (Ctrl-C).
 */
export async function runDevServer(options: { port?: number } = {}) {
  const port = options.port ?? 8787;
  debug("runDevServer port=%d", port);

  // Make sure .dev.vars exists
  ensureDevVars();

  log(bold("\n🔥 Keyflare Dev Server\n"));
  log(dim(`Starting wrangler dev on port ${port}...`));
  log(dim(`Press Ctrl-C to stop.\n`));

  const proc = spawn(
    "npx",
    ["wrangler", "dev", "--port", String(port)],
    {
      stdio: "inherit",
      cwd: serverDir(),
      env: { ...process.env },
    }
  );

  proc.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  // Forward signals
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => proc.kill(sig));
  }
}

/**
 * `kfl dev init` — Full local bootstrap without Cloudflare.
 *
 * 1. Generates/uses local MASTER_KEY in .dev.vars
 * 2. Applies D1 migrations locally
 * 3. Starts wrangler dev in the background long enough to bootstrap
 * 4. Calls /bootstrap → saves credentials pointing at localhost
 */
export async function runDevInit(options: { force?: boolean } = {}) {
  debug("runDevInit force=%s", Boolean(options.force));
  log(bold("\n🔥 Keyflare Local Setup\n"));
  log(
    dim(
      "No Cloudflare account needed — everything runs locally via wrangler.\n"
    )
  );

  // ── Step 1: .dev.vars
  const devVarsSpinner = ora("Setting up local master key...").start();
  ensureDevVars(options.force);
  devVarsSpinner.succeed(
    `Local master key ready ${dim("(packages/server/.dev.vars)")}`
  );

  // ── Step 2: Migrations
  const migrateSpinner = ora("Applying D1 migrations locally...").start();
  try {
    applyLocalMigrations();
    migrateSpinner.succeed("Local database schema up-to-date");
  } catch (err: any) {
    migrateSpinner.fail(`Migrations failed: ${err.message}`);
    process.exit(1);
  }

  // ── Step 3: Start wrangler dev in background
  const serverSpinner = ora("Starting local server...").start();
  const port = 8787;
  const proc = spawn(
    "npx",
    ["wrangler", "dev", "--port", String(port)],
    {
      stdio: "pipe",
      cwd: serverDir(),
      env: { ...process.env },
      detached: false,
    }
  );

  // Wait until ready
  debug("waiting for local server to become healthy on port=%d", port);
  await waitForServer(port, 15_000);
  serverSpinner.succeed(`Local server ready at ${bold(LOCAL_API_URL)}`);

  // ── Step 4: Bootstrap
  const bootstrapSpinner = ora("Creating local admin API key...").start();
  process.env.KEYFLARE_API_URL = LOCAL_API_URL;

  let adminKey: string;
  try {
    const data = await api.post<BootstrapResponse>("/bootstrap");
    adminKey = data.key;
    debug("local bootstrap created admin key (%s)", redact(adminKey));
    bootstrapSpinner.succeed("Admin API key created");
  } catch (err: any) {
    if (err instanceof KeyflareApiError && err.code === "CONFLICT") {
      bootstrapSpinner.succeed("Local instance already initialised — existing API keys preserved");
      warn(
        "To reset, delete the local .wrangler/ state directory\n" +
        `in packages/server and run this command again.\n`
      );
      proc.kill();
      process.exit(0);
    }
    bootstrapSpinner.fail(`Bootstrap failed: ${err.message}`);
    proc.kill();
    process.exit(1);
  }

  proc.kill();

  // ── Step 5: Save config
  writeConfig({ apiUrl: LOCAL_API_URL });
  writeApiKey(adminKey);
  debug("local config and api key written");

  log(
    `\n${bold("✓ Local setup complete!")}\n\n` +
    `Your admin API key ${dim("(saved to ~/.config/keyflare/)")}:\n\n` +
    `  ${bold(adminKey)}\n\n` +
    `Start the local server anytime with:\n\n` +
    `  ${bold("kfl dev server")}\n\n` +
    `Or set these env vars to use the local instance:\n\n` +
    `  ${bold(`KEYFLARE_LOCAL=true`)}\n` +
    `  ${bold(`KEYFLARE_API_KEY=${adminKey}`)}\n`
  );
}

// ─── Helpers ──────────────────────────────────────────────────

async function waitForServer(
  port: number,
  timeoutMs: number
): Promise<void> {
  debug("waitForServer start port=%d timeoutMs=%d", port, timeoutMs);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}
