import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { select, confirm, password } from "@inquirer/prompts";
import ora from "ora";
import type { BootstrapResponse } from "@keyflare/shared";
import { api, KeyflareApiError } from "../api/client.js";
import { writeConfig, writeApiKey, readConfig } from "../config.js";
import { log, success, warn, error, bold, dim } from "../output/log.js";

// ─── Types ────────────────────────────────────────────────────

interface WorkerVersionInfo {
  id: string;
  number: number;
  metadata: {
    bindings: {
      d1_databases?: Array<{
        name: string;
        id: string;
      }>;
    };
  };
}

/**
 * Master key format: base64-encoded 256-bit (32-byte) key.
 * When decoded from base64, it must be exactly 32 bytes.
 *
 * Example: K7gNU3sdo+OL0wNhqoVWhr3g6s1xYv72ol/pe/Unols=
 */
const MASTER_KEY_REGEX = /^[A-Za-z0-9+/]{43}={0,2}$/;

function validateMasterKey(key: string): { valid: boolean; error?: string } {
  if (!key || typeof key !== "string") {
    return { valid: false, error: "Master key is required" };
  }

  // Check base64 format (43-45 chars for 32 bytes)
  if (!MASTER_KEY_REGEX.test(key.trim())) {
    return {
      valid: false,
      error:
        "Master key must be a base64-encoded 256-bit key (44 chars, e.g., K7gNU3sdo+OL0wNhqoVWhr3g6s1xYv72ol/pe/Unols=)",
    };
  }

  // Verify it decodes to exactly 32 bytes
  try {
    const decoded = Buffer.from(key.trim(), "base64");
    if (decoded.length !== 32) {
      return {
        valid: false,
        error: `Master key must decode to 32 bytes, got ${decoded.length} bytes`,
      };
    }
  } catch {
    return { valid: false, error: "Master key is not valid base64" };
  }

  return { valid: true };
}

// ─── Auth helpers ─────────────────────────────────────────────

/**
 * Determine how to authenticate with Cloudflare.
 * Returns the env vars to inject into wrangler child processes,
 * and a flag indicating whether OAuth was used.
 */
async function resolveCloudflareAuth(): Promise<{
  env: Record<string, string>;
  method: "oauth" | "token";
}> {
  // If an API token is already set in the environment, use it directly
  if (process.env.CLOUDFLARE_API_TOKEN) {
    return {
      env: { CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN },
      method: "token",
    };
  }

  // Check if wrangler already has a cached OAuth session
  const hasOAuthSession = checkWranglerOAuthSession();

  const method = await select({
    message: "How would you like to authenticate with Cloudflare?",
    choices: [
      {
        name: "Browser (OAuth) — opens cloudflare.com in your browser",
        value: "oauth" as const,
        disabled: false,
      },
      {
        name: "API Token — paste a Cloudflare API token",
        value: "token" as const,
      },
    ],
    default: hasOAuthSession ? "oauth" : "token",
  });

  if (method === "oauth") {
    // Trigger wrangler-login OAuth flow
    log(
      dim(
        "\nOpening Cloudflare login in your browser. Press Enter here when done..."
      )
    );
    const result = spawnSync("npx", ["wrangler", "login"], {
      stdio: "inherit",
    });
    if (result.status !== 0) {
      throw new Error("Cloudflare OAuth login failed");
    }
    // After wrangler login, wrangler uses its own cached token — no env var needed
    return { env: {}, method: "oauth" };
  } else {
    // API token flow
    const token = await password({
      message: "Paste your Cloudflare API token:",
      validate: (v) => (v.length > 10 ? true : "Token looks too short"),
    });
    return {
      env: { CLOUDFLARE_API_TOKEN: token },
      method: "token",
    };
  }
}

function checkWranglerOAuthSession(): boolean {
  try {
    // wrangler whoami exits 0 if authenticated
    const result = spawnSync("npx", ["wrangler", "whoami"], {
      stdio: "pipe",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function wrangler(
  args: string[],
  authEnv: Record<string, string>,
  cwd?: string,
  options?: { ignoreError?: boolean }
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync("npx", ["wrangler", ...args], {
    stdio: ["inherit", "pipe", "pipe"],
    cwd,
    env: { ...process.env, ...authEnv },
  });

  if (!options?.ignoreError && result.status !== 0) {
    const stderr = result.stderr?.toString() ?? "";
    throw new Error(`wrangler ${args[0]} failed:\n${stderr}`);
  }

  return {
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    status: result.status,
  };
}

/**
 * Check if a worker named "keyflare" already exists.
 * Returns worker info if it exists, or null if it doesn't.
 */
function checkWorkerExists(
  authEnv: Record<string, string>
): { exists: boolean; databaseId?: string } {
  const result = wrangler(
    ["versions", "list", "--name", "keyflare", "--json"],
    authEnv,
    undefined,
    { ignoreError: true }
  );

  if (result.status !== 0) {
    // Check for "Worker does not exist" error
    if (result.stderr.includes("does not exist") || result.stderr.includes("10007")) {
      return { exists: false };
    }
    // Some other error
    return { exists: false };
  }

  // Worker exists — try to get the D1 binding from the latest version
  try {
    const versions = JSON.parse(result.stdout) as WorkerVersionInfo[];
    if (versions.length === 0) {
      return { exists: true }; // Exists but no versions? Weird but handle it
    }

    // Get the latest version's bindings
    const latestVersion = versions[0];
    const d1Bindings = latestVersion.metadata?.bindings?.d1_databases;
    if (d1Bindings && d1Bindings.length > 0) {
      return { exists: true, databaseId: d1Bindings[0].id };
    }
  } catch {
    // JSON parse failed, but worker exists
  }

  return { exists: true };
}

/**
 * Find the keyflare-db D1 database ID from the list of databases.
 */
function findKeyflareDbId(authEnv: Record<string, string>): string | undefined {
  const result = wrangler(["d1", "list", "--json"], authEnv, undefined, {
    ignoreError: true,
  });

  if (result.status !== 0) {
    return undefined;
  }

  try {
    const dbs = JSON.parse(result.stdout) as Array<{
      uuid: string;
      name: string;
    }>;
    const keyflareDb = dbs.find((db) => db.name === "keyflare-db");
    return keyflareDb?.uuid;
  } catch {
    return undefined;
  }
}

// ─── kfl init (remote deploy) ─────────────────────────────────

export async function runInit(options: { force?: boolean; masterKey?: string }) {
  log(bold("\n🔥 Keyflare — Initial Setup\n"));

  // Validate custom master key if provided
  let customMasterKey: string | undefined;
  if (options.masterKey) {
    const validation = validateMasterKey(options.masterKey);
    if (!validation.valid) {
      error(`Invalid master key: ${validation.error}`);
      process.exit(1);
    }
    customMasterKey = options.masterKey.trim();
    log(dim("Using custom master key provided via --masterkey flag\n"));
  }

  // ── Step 1: Cloudflare auth
  const spinner = ora("Checking Cloudflare authentication...").start();
  spinner.stop();

  let authEnv: Record<string, string>;
  try {
    const auth = await resolveCloudflareAuth();
    authEnv = auth.env;
  } catch (err: any) {
    error(`Authentication failed: ${err.message}`);
    process.exit(1);
  }

  // Verify auth works
  const verifySpinner = ora("Verifying Cloudflare credentials...").start();
  try {
    const whoami = wrangler(["whoami"], authEnv);
    const accountMatch = whoami.stdout.match(/Account Name:\s+(.+)/);
    const accountName = accountMatch?.[1]?.trim() ?? "your account";
    verifySpinner.succeed(`Authenticated as: ${bold(accountName)}`);
  } catch {
    verifySpinner.fail("Could not verify Cloudflare credentials");
    process.exit(1);
  }

  // ── Step 2: Check if worker already exists (update flow)
  const checkSpinner = ora("Checking for existing Keyflare deployment...").start();
  const workerStatus = checkWorkerExists(authEnv);

  if (workerStatus.exists) {
    checkSpinner.warn("Found existing Keyflare worker deployment!");

    // Try to find the D1 database ID
    const databaseId = workerStatus.databaseId ?? findKeyflareDbId(authEnv);

    if (!databaseId) {
      warn("Could not determine the D1 database ID for the existing deployment.");
      error("Aborting. Please manually delete the worker or use a different Cloudflare account.");
      process.exit(1);
    }

    log("");
    warn("An existing Keyflare deployment was found:");
    log(`  Worker: ${bold("keyflare")}`);
    log(`  D1 Database: ${dim(databaseId)}`);
    log("");

    const shouldUpdate = await confirm({
      message: "Do you want to UPDATE the existing deployment?",
      default: false,
    });

    if (!shouldUpdate) {
      log("");
      error("kfl init aborted.");
      log("");
      log("To initialize a fresh Keyflare deployment, you need to either:");
      log(`  1. Delete the existing worker: ${dim("wrangler delete keyflare")}`);
      log(`  2. Use a different Cloudflare account`);
      log("");
      log("Note: Deleting the worker does NOT delete the D1 database.");
      log(`      To also delete the database: ${dim("wrangler d1 delete keyflare-db")}`);
      process.exit(1);
    }

    // ── UPDATE FLOW ────────────────────────────────────────────
    log("");
    log(bold("Updating existing Keyflare deployment...\n"));

    // Warn if user provided --masterkey during update (it will be ignored)
    if (customMasterKey) {
      warn(
        "Note: --masterkey is ignored during updates. The existing master key will be preserved."
      );
      log("");
    }

    // Patch wrangler.toml with the existing database ID
    const serverDir = path.resolve(
      new URL(".", import.meta.url).pathname,
      "../../server"
    );
    const wranglerTomlPath = path.join(serverDir, "wrangler.toml");

    const tomlContent = `name = "keyflare"
main = "src/index.ts"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "keyflare-db"
database_id = "${databaseId}"
migrations_dir = "migrations"
`;
    fs.writeFileSync(wranglerTomlPath, tomlContent, "utf8");
    success("Updated wrangler.toml with D1 database binding");

    // Deploy new worker version
    const deploySpinner = ora("Deploying updated Keyflare Worker...").start();
    let workerUrl: string;
    try {
      const deployOutput = wrangler(["deploy"], authEnv, serverDir);
      const urlMatch = deployOutput.stdout.match(/https:\/\/[\w.-]+\.workers\.dev/);
      workerUrl = urlMatch?.[0] ?? "";
      deploySpinner.succeed(
        `Worker updated${workerUrl ? `: ${bold(workerUrl)}` : ""}`
      );
    } catch (err: any) {
      deploySpinner.fail(`Worker deployment failed: ${err.message}`);
      process.exit(1);
    }

    // Run migrations (may be no-op if schema is already up to date)
    const migrateSpinner = ora("Running database migrations...").start();
    try {
      wrangler(
        ["d1", "migrations", "apply", "keyflare-db", "--remote"],
        authEnv,
        serverDir
      );
      migrateSpinner.succeed("Database migrations applied");
    } catch (err: any) {
      // Check if it's just "already applied" error
      if (err.message.includes("already been applied") || err.message.includes("no migrations")) {
        migrateSpinner.succeed("Database schema already up to date");
      } else {
        migrateSpinner.fail(`Migrations failed: ${err.message}`);
        process.exit(1);
      }
    }

    // Update config with the API URL (in case it changed)
    const apiUrl = workerUrl || `https://keyflare.workers.dev`;
    const existingConfig = readConfig();
    writeConfig({ apiUrl, project: existingConfig.project, environment: existingConfig.environment });

    log("");
    success(bold("✓ Keyflare updated successfully!"));
    log("");
    log(dim(`API URL: ${apiUrl}`));
    log(dim(`Config:  ~/.config/keyflare/\n`));
    return;
  }

  checkSpinner.succeed("No existing Keyflare deployment found");

  // ── FRESH INSTALL FLOW ──────────────────────────────────────
  log("");
  log("Setting up a fresh Keyflare deployment...\n");

  // ── Step 3: Create D1 database
  const dbSpinner = ora("Creating D1 database: keyflare-db...").start();
  let databaseId: string;
  try {
    const output = wrangler(["d1", "create", "keyflare-db"], authEnv);
    const match = output.stdout.match(/database_id\s*=\s*"?([a-f0-9-]{36})"?/);
    if (!match) {
      throw new Error(`Could not parse database_id from output:\n${output.stdout}`);
    }
    databaseId = match[1];
    dbSpinner.succeed(`Created D1 database: keyflare-db (id: ${dim(databaseId)})`);
  } catch (err: any) {
    // Database might already exist — try to find it
    dbSpinner.text = "Database may already exist, looking it up...";
    try {
      const listOutput = wrangler(["d1", "list"], authEnv);
      const lines = listOutput.stdout.split("\n");
      const dbLine = lines.find((l) => l.includes("keyflare-db"));
      if (!dbLine) throw new Error("keyflare-db not found in list");
      const uuidMatch = dbLine.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
      if (!uuidMatch) throw new Error("Could not parse database_id from list");
      databaseId = uuidMatch[1];
      dbSpinner.succeed(
        `Using existing D1 database: keyflare-db (id: ${dim(databaseId)})`
      );
    } catch {
      dbSpinner.fail(`D1 database creation failed: ${err.message}`);
      process.exit(1);
    }
  }

  // ── Step 4: Patch wrangler.toml with real database_id
  const serverDir = path.resolve(
    new URL(".", import.meta.url).pathname,
    "../../server"
  );
  const wranglerTomlPath = path.join(serverDir, "wrangler.toml");

  const tomlContent = `name = "keyflare"
main = "src/index.ts"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "keyflare-db"
database_id = "${databaseId}"
migrations_dir = "migrations"
`;
  fs.writeFileSync(wranglerTomlPath, tomlContent, "utf8");
  success("Updated wrangler.toml with D1 database binding");

  // ── Step 5: Generate or use master key
  const masterKey = customMasterKey ?? generateMasterKey();

  // Show master key and require confirmation (only if auto-generated)
  if (!customMasterKey) {
    warn(
      `\n⚠️  MASTER KEY — Save this somewhere safe. It cannot be recovered!\n`
    );
    log(bold(`  ${masterKey}\n`));
    await confirm({ message: "I have saved the master key", default: false });
  }

  // ── Step 6: Deploy Worker
  const deploySpinner = ora("Deploying Keyflare Worker...").start();
  let workerUrl: string;
  try {
    const deployOutput = wrangler(["deploy"], authEnv, serverDir);
    const urlMatch = deployOutput.stdout.match(/https:\/\/[\w.-]+\.workers\.dev/);
    workerUrl = urlMatch?.[0] ?? "";
    deploySpinner.succeed(
      `Worker deployed${workerUrl ? `: ${bold(workerUrl)}` : ""}`
    );
  } catch (err: any) {
    deploySpinner.fail(`Worker deployment failed: ${err.message}`);
    process.exit(1);
  }

  // ── Step 7: Push MASTER_KEY as Worker secret
  const secretSpinner = ora("Pushing master key to Worker secrets...").start();
  try {
    const result = spawnSync(
      "npx",
      ["wrangler", "secret", "put", "MASTER_KEY"],
      {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: serverDir,
        input: masterKey + "\n",
        env: { ...process.env, ...authEnv },
      }
    );
    if (result.status !== 0) {
      throw new Error(result.stderr?.toString() ?? "unknown error");
    }
    secretSpinner.succeed("Master key stored as Worker secret");
  } catch (err: any) {
    secretSpinner.fail(`Failed to push master key: ${err.message}`);
    process.exit(1);
  }

  // ── Step 8: Run D1 migrations
  const migrateSpinner = ora("Running database migrations...").start();
  try {
    wrangler(
      ["d1", "migrations", "apply", "keyflare-db", "--remote"],
      authEnv,
      serverDir
    );
    migrateSpinner.succeed("Database schema initialized");
  } catch (err: any) {
    migrateSpinner.fail(`Migrations failed: ${err.message}`);
    process.exit(1);
  }

  // ── Step 9: Bootstrap — create first user key
  const bootstrapSpinner = ora("Creating root API key...").start();
  const apiUrl = workerUrl || `https://keyflare.workers.dev`;

  // Temporarily set the API URL to bootstrap
  process.env.KEYFLARE_API_URL = apiUrl;

  let rootKey: string;
  try {
    const data = await api.post<BootstrapResponse>("/bootstrap");
    rootKey = data.key;
    bootstrapSpinner.succeed("Root API key created");
  } catch (err: any) {
    if (err instanceof KeyflareApiError && err.code === "CONFLICT") {
      bootstrapSpinner.warn(
        "Bootstrap already done — a root key already exists"
      );
      warn(
        "If you lost your root key, create a new one via an existing user key.\n"
      );
      process.exit(0);
    }
    bootstrapSpinner.fail(`Bootstrap failed: ${err.message}`);
    process.exit(1);
  }

  // ── Step 10: Save config
  writeConfig({ apiUrl });
  writeApiKey(rootKey);

  log(
    `\n${bold("✓ Setup complete!")}\n\nYour root API key ${dim("(shown once — already saved to ~/.config/keyflare/)")}: \n\n  ${bold(rootKey)}\n`
  );

  // Show master key one more time at the end (for fresh installs)
  warn(bold("⚠️  IMPORTANT: Your master key (save this securely!)\n"));
  log(`  ${bold(masterKey)}\n`);
  log(
    dim(
      "This key is shown ONCE. Store it safely — if lost, all encrypted data\n" +
        "in D1 becomes permanently unrecoverable. If compromised, re-encrypt\n" +
        "everything with a new key.\n"
    )
  );

  log(dim(`API URL: ${apiUrl}`));
  log(dim(`Config:  ~/.config/keyflare/\n`));
}

// ─── Helpers ──────────────────────────────────────────────────

function generateMasterKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}
