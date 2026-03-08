import { spawnSync } from "node:child_process";
import path from "node:path";
import { select, confirm, password } from "@inquirer/prompts";
import ora from "ora";
import type { BootstrapResponse } from "@keyflare/shared";
import { api, KeyflareApiError } from "../api/client.js";
import { writeConfig, writeApiKey, readConfig } from "../config.js";
import { makeDebug, redact } from "../debug.js";
import { log, success, warn, error, bold, dim } from "../output/log.js";

const debug = makeDebug("init");

/**
 * Master key format: base64-encoded 256-bit (32-byte) key.
 * When decoded from base64, it must be exactly 32 bytes.
 *
 * Example: K7gNU3sdo+OL0wNhqoVWhr3g6s1xYv72ol/pe/Unols=
 */
const MASTER_KEY_REGEX = /^[A-Za-z0-9+/]{43}={0,2}$/;

function validateMasterKey(key: string): { valid: boolean; error?: string } {
  debug("validating master key (len=%d)", key?.length ?? 0);
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
  debug("resolving Cloudflare auth strategy");
  // Check first if wrangler already has an authenticated session.
  // If so, reuse it without prompting.
  const hasOAuthSession = checkWranglerOAuthSession();
  if (hasOAuthSession) {
    debug("reusing existing wrangler oauth session");
    return { env: {}, method: "oauth" };
  }

  // If an API token is already set in the environment, use it directly.
  if (process.env.CLOUDFLARE_API_TOKEN) {
    debug(
      "using CLOUDFLARE_API_TOKEN from env (%s)",
      redact(process.env.CLOUDFLARE_API_TOKEN)
    );
    return {
      env: { CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN },
      method: "token",
    };
  }

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
    debug("selected oauth auth flow");
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
    debug("selected api token auth flow");
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
    const result = spawnSync("npx", ["wrangler", "whoami", "--json"], {
      stdio: "pipe",
    });

    if (result.status !== 0) {
      debug("wrangler whoami --json exited with status=%s", result.status);
      return false;
    }

    const raw = result.stdout?.toString() ?? "";
    const payload = JSON.parse(raw) as { loggedIn?: boolean; authType?: string };
    const hasSession = payload.loggedIn === true;
    debug("wrangler oauth session=%s authType=%s", hasSession, payload.authType ?? "unknown");
    return hasSession;
  } catch {
    debug("wrangler whoami --json check failed while probing oauth session");
    return false;
  }
}

/** Path to packages/server relative to this compiled CLI file */
function serverDir(): string {
  const here = new URL(".", import.meta.url).pathname;
  // When built: packages/cli/dist/commands/init.js → ../../../server
  // When running via tsx: packages/cli/src/commands/init.ts → ../../../server
  return path.resolve(here, "../../../server");
}

function wrangler(
  args: string[],
  authEnv: Record<string, string>,
  cwd?: string,
  options?: { ignoreError?: boolean }
): { stdout: string; stderr: string; status: number | null } {
  debug("wrangler %o cwd=%s", args, cwd ?? process.cwd());
  const result = spawnSync("npx", ["wrangler", ...args], {
    stdio: ["inherit", "pipe", "pipe"],
    cwd,
    env: { ...process.env, ...authEnv },
  });

  if (!options?.ignoreError && result.status !== 0) {
    const stderr = result.stderr?.toString() ?? "";
    throw new Error(`wrangler ${args[0]} failed:\n${stderr}`);
  }

  debug(
    "wrangler done status=%s stdoutLen=%d stderrLen=%d",
    result.status,
    result.stdout?.toString()?.length ?? 0,
    result.stderr?.toString()?.length ?? 0
  );

  return {
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    status: result.status,
  };
}

function workerHasMasterKeySecret(authEnv: Record<string, string>): boolean {
  debug("checking if worker has MASTER_KEY secret");
  const result = wrangler(
    ["secret", "list", "--name", "keyflare", "--format", "json"],
    authEnv,
    serverDir(),
    {
      ignoreError: true,
    }
  );

  if (result.status !== 0) {
    debug("secret list failed (worker likely not created yet)");
    return false;
  }

  try {
    const secrets = JSON.parse(result.stdout) as Array<{ name?: string }>;
    const hasSecret = secrets.some((secret) => secret.name === "MASTER_KEY");
    debug("secret list parsed: has MASTER_KEY=%s", hasSecret);
    return hasSecret;
  } catch {
    const hasSecret = result.stdout.includes("MASTER_KEY");
    debug("secret list json parse failed; fallback scan has MASTER_KEY=%s", hasSecret);
    return hasSecret;
  }
}

// ─── kfl init (remote deploy) ─────────────────────────────────

export async function runInit(options: { force?: boolean; masterKey?: string }) {
  debug("runInit called force=%s masterKeyProvided=%s", Boolean(options.force), Boolean(options.masterKey));
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
    debug("custom master key accepted (%s)", redact(customMasterKey));
    log(dim("Using custom master key provided via --masterkey flag\n"));
  }

  // ── Step 1: Cloudflare auth
  const spinner = ora("Checking Cloudflare authentication...").start();
  spinner.stop();

  let authEnv: Record<string, string>;
  try {
    const auth = await resolveCloudflareAuth();
    authEnv = auth.env;
    debug("auth resolved via method=%s", auth.method);
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
    debug("authenticated account=%s", accountName);
    verifySpinner.succeed(`Authenticated as: ${bold(accountName)}`);
  } catch {
    verifySpinner.fail("Could not verify Cloudflare credentials");
    process.exit(1);
  }

  // ── Step 2: Deploy worker (idempotent)
  const deploySpinner = ora("Deploying Keyflare Worker...").start();
  let workerUrl = "";
  try {
    const deployOutput = wrangler(["deploy"], authEnv, serverDir());
    const urlMatch = deployOutput.stdout.match(/https:\/\/[\w.-]+\.workers\.dev/);
    workerUrl = urlMatch?.[0] ?? "";
    debug("deploy completed workerUrl=%s", workerUrl || "<not parsed>");
    deploySpinner.succeed(
      `Worker deployed${workerUrl ? `: ${bold(workerUrl)}` : ""}`
    );
  } catch (err: any) {
    deploySpinner.fail(`Worker deployment failed: ${err.message}`);
    process.exit(1);
  }

  // ── Step 3: Ensure MASTER_KEY exists (never overwrite)
  const checkSecretSpinner = ora("Checking Worker secrets...").start();
  const hasExistingMasterKey = workerHasMasterKeySecret(authEnv);
  checkSecretSpinner.succeed(
    hasExistingMasterKey
      ? "Found existing MASTER_KEY secret"
      : "No MASTER_KEY secret found"
  );

  let masterKeyToDisplay: string | undefined;
  if (hasExistingMasterKey) {
    if (customMasterKey) {
      warn(
        "MASTER_KEY already exists on the worker. --masterkey was ignored to avoid overriding it."
      );
    }
  } else {
    const masterKey = customMasterKey ?? generateMasterKey();
    debug("generated new master key (%s)", redact(masterKey));

    const secretSpinner = ora("Pushing master key to Worker secrets...").start();
    try {
      const result = spawnSync(
        "npx",
        ["wrangler", "secret", "put", "MASTER_KEY"],
        {
          stdio: ["pipe", "pipe", "pipe"],
          cwd: serverDir(),
          input: masterKey + "\n",
          env: { ...process.env, ...authEnv },
        }
      );
      if (result.status !== 0) {
        throw new Error(result.stderr?.toString() ?? "unknown error");
      }
      debug("MASTER_KEY secret stored");
      secretSpinner.succeed("Master key stored as Worker secret");
      masterKeyToDisplay = masterKey;

      if (!customMasterKey) {
        warn(
          `\n⚠️  MASTER KEY — Save this somewhere safe. It cannot be recovered!\n`
        );
        log(bold(`  ${masterKey}\n`));
        await confirm({ message: "I have saved the master key", default: false });
      }
    } catch (err: any) {
      secretSpinner.fail(`Failed to push master key: ${err.message}`);
      process.exit(1);
    }
  }

  // ── Step 4: Run D1 migrations
  const migrateSpinner = ora("Running database migrations...").start();
  try {
    wrangler(["d1", "migrations", "apply", "keyflare", "--remote"], authEnv, serverDir());
    debug("migrations apply completed");
    migrateSpinner.succeed("Database migrations applied");
  } catch (err: any) {
    if (err.message.includes("already been applied") || err.message.includes("No migrations to apply")) {
      migrateSpinner.succeed("Database schema already up to date");
    } else {
      migrateSpinner.fail(`Migrations failed: ${err.message}`);
      process.exit(1);
    }
  }

  // ── Step 5: Bootstrap — create first user key (idempotent)
  const bootstrapSpinner = ora("Creating root API key...").start();
  const apiUrl = workerUrl || `https://keyflare.workers.dev`;
  debug("bootstrap using apiUrl=%s", apiUrl);

  // Temporarily set the API URL to bootstrap
  process.env.KEYFLARE_API_URL = apiUrl;

  let rootKey: string | undefined;
  try {
    const data = await api.post<BootstrapResponse>("/bootstrap");
    rootKey = data.key;
    debug("bootstrap created root key (%s)", redact(rootKey));
    bootstrapSpinner.succeed("Root API key created");
  } catch (err: any) {
    if (err instanceof KeyflareApiError && err.code === "CONFLICT") {
      bootstrapSpinner.warn(
        "Bootstrap already done — a root key already exists"
      );
      warn("If you lost your root key, create a new one via an existing user key.");
    } else {
      bootstrapSpinner.fail(`Bootstrap failed: ${err.message}`);
      process.exit(1);
    }
  }

  // ── Step 6: Save config
  const existingConfig = readConfig();
  writeConfig({ apiUrl, project: existingConfig.project, environment: existingConfig.environment });
  if (rootKey) {
    writeApiKey(rootKey);
  }
  debug("config written; rootKeySaved=%s", Boolean(rootKey));

  log("");
  success(bold("✓ Keyflare deployed successfully!"));
  if (rootKey) {
    log(
      `\nYour root API key ${dim("(shown once — already saved to ~/.config/keyflare/)")}:\n\n  ${bold(rootKey)}\n`
    );
  }

  if (masterKeyToDisplay) {
    warn(bold("⚠️  IMPORTANT: Your master key (save this securely!)\n"));
    log(`  ${bold(masterKeyToDisplay)}\n`);
    log(
      dim(
        "This key is shown ONCE. Store it safely — if lost, all encrypted data\n" +
          "in D1 becomes permanently unrecoverable. If compromised, re-encrypt\n" +
          "everything with a new key.\n"
      )
    );
  } else {
    log(dim("MASTER_KEY already exists on the worker and was left unchanged.\n"));
  }

  log(dim(`API URL: ${apiUrl}`));
  log(dim(`Config:  ~/.config/keyflare/\n`));
}

// ─── Helpers ──────────────────────────────────────────────────

function generateMasterKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const key = Buffer.from(bytes).toString("base64");
  debug("master key generated (%s)", redact(key));
  return key;
}
