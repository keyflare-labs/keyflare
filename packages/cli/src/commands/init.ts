import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { input, select, confirm, password } from "@inquirer/prompts";
import ora from "ora";
import type { BootstrapResponse } from "@keyflare/shared";
import { api, KeyflareApiError } from "../api/client.js";
import { writeConfig, writeApiKey } from "../config.js";
import { log, success, warn, error, bold, dim } from "../output/log.js";

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
    // Trigger wrangler login OAuth flow
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
  cwd?: string
): string {
  const result = spawnSync("npx", ["wrangler", ...args], {
    stdio: ["inherit", "pipe", "pipe"],
    cwd,
    env: { ...process.env, ...authEnv },
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? "";
    throw new Error(`wrangler ${args[0]} failed:\n${stderr}`);
  }
  return result.stdout?.toString() ?? "";
}

// ─── kfl init (remote deploy) ─────────────────────────────────

export async function runInit(options: { force?: boolean }) {
  log(bold("\n🔥 Keyflare — Initial Setup\n"));

  // ── Step 1: Cloudflare auth
  const spinner = ora("Checking Cloudflare authentication...").start();
  spinner.stop();

  let authEnv: Record<string, string>;
  let authMethod: "oauth" | "token";
  try {
    const auth = await resolveCloudflareAuth();
    authEnv = auth.env;
    authMethod = auth.method;
  } catch (err: any) {
    error(`Authentication failed: ${err.message}`);
    process.exit(1);
  }

  // Verify auth works
  const verifySpinner = ora("Verifying Cloudflare credentials...").start();
  try {
    const whoami = wrangler(["whoami"], authEnv);
    const accountMatch = whoami.match(/Account Name:\s+(.+)/);
    const accountName = accountMatch?.[1]?.trim() ?? "your account";
    verifySpinner.succeed(`Authenticated as: ${bold(accountName)}`);
  } catch {
    verifySpinner.fail("Could not verify Cloudflare credentials");
    process.exit(1);
  }

  // ── Step 2: Create D1 database
  const dbSpinner = ora("Creating D1 database: keyflare-db...").start();
  let databaseId: string;
  try {
    const output = wrangler(
      ["d1", "create", "keyflare-db"],
      authEnv
    );
    // Parse database_id from output:
    // "database_id = "abc-123-...""
    const match = output.match(/database_id\s*=\s*"?([a-f0-9-]{36})"?/);
    if (!match) {
      throw new Error(
        `Could not parse database_id from output:\n${output}`
      );
    }
    databaseId = match[1];
    dbSpinner.succeed(`Created D1 database: keyflare-db (id: ${dim(databaseId)})`);
  } catch (err: any) {
    // Database might already exist — try to find it
    dbSpinner.text = "Database may already exist, looking it up...";
    try {
      const listOutput = wrangler(["d1", "list"], authEnv);
      const lines = listOutput.split("\n");
      const dbLine = lines.find((l) => l.includes("keyflare-db"));
      if (!dbLine) throw new Error("keyflare-db not found in list");
      // Extract UUID from the line
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

  // ── Step 3: Patch wrangler.toml with real database_id
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

  // ── Step 4: Generate master key
  const masterKey = generateMasterKey();
  warn(
    `\n⚠️  MASTER KEY — Save this somewhere safe. It cannot be recovered!\n`
  );
  log(bold(`  ${masterKey}\n`));
  await confirm({ message: "I have saved the master key", default: false });

  // ── Step 5: Deploy Worker
  const deploySpinner = ora("Deploying Keyflare Worker...").start();
  let workerUrl: string;
  try {
    const deployOutput = wrangler(["deploy"], authEnv, serverDir);
    // Parse Worker URL from deploy output: "https://keyflare.xxx.workers.dev"
    const urlMatch = deployOutput.match(/https:\/\/[\w.-]+\.workers\.dev/);
    workerUrl = urlMatch?.[0] ?? "";
    deploySpinner.succeed(
      `Worker deployed${workerUrl ? `: ${bold(workerUrl)}` : ""}`
    );
  } catch (err: any) {
    deploySpinner.fail(`Worker deployment failed: ${err.message}`);
    process.exit(1);
  }

  // ── Step 6: Push MASTER_KEY as Worker secret
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

  // ── Step 7: Run D1 migrations
  const migrateSpinner = ora("Running database migrations...").start();
  try {
    wrangler(
      [
        "d1",
        "migrations",
        "apply",
        "keyflare-db",
        "--remote",
      ],
      authEnv,
      serverDir
    );
    migrateSpinner.succeed("Database schema initialized");
  } catch (err: any) {
    migrateSpinner.fail(`Migrations failed: ${err.message}`);
    process.exit(1);
  }

  // ── Step 8: Bootstrap — create first user key
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

  // ── Step 9: Save config
  writeConfig({ apiUrl });
  writeApiKey(rootKey);

  log(
    `\n${bold("✓ Setup complete!")}\n\nYour root API key ${dim("(shown once — already saved to ~/.config/keyflare/)")}: \n\n  ${bold(rootKey)}\n`
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
