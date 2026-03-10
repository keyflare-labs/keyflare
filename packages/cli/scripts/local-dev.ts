/**
 * Local development script for Keyflare contributors.
 *
 * Usage (from repo root):
 *   pnpm run dev:init    — one-time setup (master key, migrations, bootstrap)
 *   pnpm run dev:server  — start local server on port 8787
 *
 * No Cloudflare account needed. Everything runs via Miniflare/wrangler.
 */

import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ora from "ora";
import type { BootstrapResponse } from "@keyflare/shared";
import { api, KeyflareApiError } from "../src/api/client.js";
import { writeConfig, writeApiKey } from "../src/config.js";
import { makeDebug, redact } from "../src/debug.js";
import { log, warn, success, bold, dim } from "../src/output/log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_API_URL = "http://localhost:8787";
const debug = makeDebug("local-dev");

function serverDir(): string {
  const dir = path.resolve(__dirname, "../../server");
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

function ensureDevVars(force = false): string {
  debug("ensureDevVars force=%s", force);
  const devVars = devVarsPath();
  if (!force && fs.existsSync(devVars)) {
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

function applyLocalMigrations() {
  debug("applying local migrations via wrangler");
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

async function runDevServer(options: { port?: number } = {}) {
  const port = options.port ?? 8787;
  debug("runDevServer port=%d", port);

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

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => proc.kill(sig));
  }
}

async function runDevInit(options: { force?: boolean } = {}) {
  debug("runDevInit force=%s", Boolean(options.force));
  log(bold("\n🔥 Keyflare Local Setup\n"));
  log(
    dim(
      "No Cloudflare account needed — everything runs locally via wrangler.\n"
    )
  );

  const devVarsSpinner = ora("Setting up local master key...").start();
  ensureDevVars(options.force);
  devVarsSpinner.succeed(
    `Local master key ready ${dim("(packages/server/.dev.vars)")}`
  );

  const migrateSpinner = ora("Applying D1 migrations locally...").start();
  try {
    applyLocalMigrations();
    migrateSpinner.succeed("Local database schema up-to-date");
  } catch (err: any) {
    migrateSpinner.fail(`Migrations failed: ${err.message}`);
    process.exit(1);
  }

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

  debug("waiting for local server to become healthy on port=%d", port);
  await waitForServer(port, 15_000);
  serverSpinner.succeed(`Local server ready at ${bold(LOCAL_API_URL)}`);

  const bootstrapSpinner = ora("Creating local user key...").start();
  process.env.KEYFLARE_API_URL = LOCAL_API_URL;

  let adminKey: string;
  try {
    const data = await api.post<BootstrapResponse>("/bootstrap");
    adminKey = data.key;
    debug("local bootstrap created admin key (%s)", redact(adminKey));
    bootstrapSpinner.succeed("User key created");
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

  writeConfig({ apiUrl: LOCAL_API_URL });
  writeApiKey(adminKey);
  debug("local config and api key written");

  log("");
  success(bold("✓ Local setup complete!"));

  if (adminKey) {
    warn(bold("⚠️  IMPORTANT: Your user key (save this securely!)\n"));
    log(`  ${bold(adminKey)}\n`);
    log(
      dim(
        "This key is required for `kfl login`. It has been saved to\n" +
          "~/.config/keyflare/credentials, but you should back it up securely.\n"
      )
    );
  }

  log(
    `\nStart the local server anytime with:\n\n` +
    `  ${bold("pnpm run dev:server")}\n\n` +
    `Or set these env vars to use the local instance:\n\n` +
    `  ${bold(`KEYFLARE_LOCAL=true`)}\n` +
    `  ${bold(`KEYFLARE_API_KEY=${adminKey}`)}\n`
  );
}

async function waitForServer(port: number, timeoutMs: number): Promise<void> {
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

// CLI entry point
const command = process.argv[2];

switch (command) {
  case "init":
    runDevInit({ force: process.argv.includes("--force") }).catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
    break;
  case "server":
    runDevServer({ port: parseInt(process.argv[3], 10) || 8787 }).catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
    break;
  default:
    console.error(`Usage: tsx local-dev.ts <init|server> [options]`);
    console.error(`  init   — One-time local setup`);
    console.error(`  server — Start local server`);
    process.exit(1);
}
