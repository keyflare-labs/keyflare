import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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
 * Track the currently running wrangler child process so we can kill it on
 * SIGINT. Wrangler catches SIGINT itself and doesn't exit, so the terminal's
 * Ctrl+C alone won't stop it.
 */
let activeChild: import("node:child_process").ChildProcess | null = null;

/** Kill the active wrangler child process tree (if any). Called from the global SIGINT handler. */
export function killActiveChild(): void {
  if (activeChild?.pid) {
    debug("killing active wrangler process tree pgid=%d", activeChild.pid);
    try {
      // Negative PID sends signal to the entire process group (wrangler + its children)
      process.kill(-activeChild.pid, "SIGKILL");
    } catch {
      // Fallback: kill just the direct child
      try { activeChild.kill("SIGKILL"); } catch { /* already gone */ }
    }
    activeChild = null;
  }
}

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
    const result = spawnSync(wranglerBin(), ["login"], {
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
    const result = spawnSync(wranglerBin(), ["whoami", "--json"], {
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
  // When published: dist/index.js → ./server (bundled in dist)
  // When running via tsx: packages/cli/src/commands/init.ts → ../../../server (monorepo)
  const publishedPath = path.resolve(here, "server");
  const devPath = path.resolve(here, "../../../server");

  if (fs.existsSync(path.join(publishedPath, "wrangler.jsonc"))) {
    debug("serverDir resolved to published path: %s", publishedPath);
    return publishedPath;
  }
  debug("serverDir resolved to dev path: %s", devPath);
  return devPath;
}

/**
 * Resolve the wrangler binary path directly, avoiding npx/npm-exec which
 * adds intermediate processes that swallow SIGINT.
 */
function wranglerBin(): string {
  const here = new URL(".", import.meta.url).pathname;

  // When published: wrangler is in CLI's node_modules (sibling to dist/)
  const publishedBinPath = path.join(here, "..", "node_modules", ".bin", "wrangler");
  if (fs.existsSync(publishedBinPath)) {
    debug("resolved wrangler binary (published): %s", publishedBinPath);
    return publishedBinPath;
  }

  // When in dev monorepo: wrangler is in server's node_modules
  const serverBinPath = path.join(serverDir(), "node_modules", ".bin", "wrangler");
  if (fs.existsSync(serverBinPath)) {
    debug("resolved wrangler binary (dev): %s", serverBinPath);
    return serverBinPath;
  }

  // Fallback: let PATH resolution find it
  debug("wrangler binary not found, falling back to PATH");
  return "wrangler";
}

async function wrangler(
  args: string[],
  authEnv: Record<string, string>,
  cwd?: string,
  options?: { ignoreError?: boolean }
): Promise<{ stdout: string; stderr: string; status: number | null }> {
  debug("wrangler %o cwd=%s", args, cwd ?? process.cwd());

  return new Promise((resolve, reject) => {
    // detached: true makes the child a process group leader so we can kill
    // the entire tree (wrangler + its sub-processes) via process.kill(-pid).
    const child = spawn(wranglerBin(), args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd,
      detached: true,
      env: { ...process.env, ...authEnv },
    });

    activeChild = child;

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    // Listen for Ctrl+C on stdin while the child is running.
    // pnpm/tsx swallow SIGINT so process.on("SIGINT") never fires — detect
    // the raw 0x03 byte (Ctrl+C) directly instead.
    let stdinWasRaw = false;
    const onStdinData = (data: Buffer) => {
      if (data[0] === 0x03) {
        debug("Ctrl+C detected on stdin, killing wrangler process tree");
        cleanupStdin();
        killActiveChild();
        // Restore cursor (ora hides it)
        process.stderr.write("\x1B[?25h");
        process.exit(130);
      }
    };

    const cleanupStdin = () => {
      process.stdin.off("data", onStdinData);
      if (process.stdin.isTTY) {
        try { process.stdin.setRawMode(stdinWasRaw); } catch { /* ignore */ }
        process.stdin.pause();
      }
    };

    if (process.stdin.isTTY) {
      stdinWasRaw = process.stdin.isRaw;
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", onStdinData);
    }

    child.on("close", (code) => {
      activeChild = null;
      cleanupStdin();

      debug(
        "wrangler done status=%s stdoutLen=%d stderrLen=%d",
        code,
        stdout.length,
        stderr.length
      );

      if (code === null) {
        reject(new Error(`wrangler ${args[0]} was terminated`));
      } else if (!options?.ignoreError && code !== 0) {
        reject(new Error(`wrangler ${args[0]} failed:\n${stderr}`));
      } else {
        resolve({ stdout, stderr, status: code });
      }
    });

    child.on("error", (err) => {
      activeChild = null;
      cleanupStdin();
      reject(err);
    });
  });
}

async function workerHasMasterKeySecret(authEnv: Record<string, string>): Promise<boolean> {
  debug("checking if worker has MASTER_KEY secret");
  const result = await wrangler(
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

// ─── Worker / D1 discovery helpers ────────────────────────────

/**
 * Returns true if the "keyflare" worker already has at least one deployment
 * on the account. Uses exit-code detection: wrangler exits 1 with code 10007
 * when the worker does not exist.
 */
async function checkWorkerExists(authEnv: Record<string, string>): Promise<boolean> {
  debug("checking if worker 'keyflare' exists via deployments list");
  const result = await wrangler(
    ["deployments", "list", "--name", "keyflare", "--json"],
    authEnv,
    serverDir(),
    { ignoreError: true }
  );

  if (result.status !== 0) {
    debug("deployments list exited %d — worker likely does not exist", result.status);
    return false;
  }

  try {
    const deployments = JSON.parse(result.stdout) as Array<unknown>;
    const exists = Array.isArray(deployments) && deployments.length > 0;
    debug("worker exists=%s (%d deployments)", exists, deployments.length);
    return exists;
  } catch {
    debug("failed to parse deployments list JSON; treating as non-existent");
    return false;
  }
}

/**
 * Reads the D1 database_id that is currently bound to the live "keyflare"
 * worker by inspecting the latest deployment's version bindings.
 *
 * Flow:
 *   1. wrangler deployments list --name keyflare --json
 *      → pick the last entry (most recent), read versions[0].version_id
 *   2. wrangler versions view <version_id> --name keyflare --json
 *      → find the binding where type === "d1", return its database_id
 *
 * Throws if the worker has no deployments or no D1 binding.
 */
async function resolveD1DatabaseId(authEnv: Record<string, string>): Promise<string> {
  debug("resolving D1 database_id from live worker bindings");

  const listResult = await wrangler(
    ["deployments", "list", "--name", "keyflare", "--json"],
    authEnv,
    serverDir()
  );

  type Deployment = { versions: Array<{ version_id: string }> };
  let deployments: Deployment[];
  try {
    deployments = JSON.parse(listResult.stdout) as Deployment[];
  } catch {
    throw new Error("Could not parse deployments list JSON");
  }

  if (!Array.isArray(deployments) || deployments.length === 0) {
    throw new Error("No deployments found for worker 'keyflare'");
  }

  const latest = deployments[deployments.length - 1];
  const versionId = latest?.versions?.[0]?.version_id;
  if (!versionId) {
    throw new Error("Latest deployment has no version_id");
  }
  debug("latest version_id=%s", versionId);

  const viewResult = await wrangler(
    ["versions", "view", versionId, "--name", "keyflare", "--json"],
    authEnv,
    serverDir()
  );

  type Binding = { type: string; database_id?: string; name: string };
  type VersionPayload = { resources?: { bindings?: Binding[] } };
  let version: VersionPayload;
  try {
    version = JSON.parse(viewResult.stdout) as VersionPayload;
  } catch {
    throw new Error("Could not parse version view JSON");
  }

  const d1Binding = version.resources?.bindings?.find((b) => b.type === "d1");
  if (!d1Binding?.database_id) {
    throw new Error(
      "No D1 binding found on worker 'keyflare'. " +
        "Ensure the wrangler.jsonc d1_databases config is present before deploying."
    );
  }

  debug("resolved database_id=%s (binding name=%s)", d1Binding.database_id, d1Binding.name);
  return d1Binding.database_id;
}

/**
 * Reads wrangler.jsonc, injects the resolved database_id, and writes the
 * result to a temporary file. Returns the temp file path.
 *
 * The caller is responsible for deleting the file when done (use a
 * try/finally block). wrangler.jsonc is never modified.
 *
 * The file uses JSONC (with // comments). We strip line comments before
 * parsing, then write back as standard JSON into the temp file.
 */
function buildEphemeralConfig(databaseId: string): string {
  const configPath = path.join(serverDir(), "wrangler.jsonc");
  debug("building ephemeral config from %s with database_id=%s", configPath, databaseId);

  const raw = fs.readFileSync(configPath, "utf-8");

  // Strip single-line // comments (sufficient for this config file)
  const stripped = raw.replace(/\/\/.*$/gm, "");

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(stripped) as Record<string, unknown>;
  } catch (e: any) {
    throw new Error(`Failed to parse wrangler.jsonc: ${e.message}`);
  }

  const databases = config.d1_databases as Array<Record<string, unknown>>;
  if (!Array.isArray(databases) || databases.length === 0) {
    throw new Error("wrangler.jsonc has no d1_databases entry");
  }

  databases[0].database_id = databaseId;
  // migrations_dir is relative in the source config; make it absolute so that
  // wrangler resolves it correctly when -c points at a file in os.tmpdir().
  databases[0].migrations_dir = path.join(serverDir(), String(databases[0].migrations_dir ?? "migrations"));

  const tmpPath = path.join(os.tmpdir(), `keyflare-wrangler-${Date.now()}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  debug("ephemeral config written to %s", tmpPath);
  return tmpPath;
}

// ─── kfl init (remote deploy) ─────────────────────────────────

export async function runInit(options: { force?: boolean; yes?: boolean; masterKey?: string }) {
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
    const whoami = await wrangler(["whoami"], authEnv);
    const lines = whoami.stdout.split("\n");
    const accountNameLine = lines.find(
      (line) => line.includes("│") && line.includes("Account") && !line.includes("Account Name")
    );
    const accountName = accountNameLine
      ? accountNameLine.split("│")[1]?.trim() ?? "your account"
      : "your account";
    debug("authenticated account=%s", accountName);
    verifySpinner.succeed(`Authenticated as: ${bold(accountName)}`);
  } catch {
    verifySpinner.fail("Could not verify Cloudflare credentials");
    process.exit(1);
  }

  // ── Step 2: Check if the worker already exists
  const workerExists = await checkWorkerExists(authEnv);
  debug("worker pre-exists=%s", workerExists);

  // ── Step 3: Resolve D1 database_id and build an ephemeral wrangler config
  //
  // On first deploy the worker doesn't exist yet, so we deploy first with the
  // base config (no database_id), then resolve the ID from the live bindings.
  // On re-runs we can resolve before deploying, but deploying first is simpler
  // and fully idempotent either way.
  //
  // The ephemeral config is a temp file that mirrors wrangler.jsonc but with
  // database_id injected. It is passed via -c to deploy and migrations so that
  // wrangler.jsonc is never modified.

  // First deploy — needed on first run so the D1 binding is created by Cloudflare.
  const deploySpinner = ora(
    workerExists ? "Redeploying Keyflare Worker..." : "Deploying Keyflare Worker..."
  ).start();
  let workerUrl = "";
  try {
    const deployOutput = await wrangler(["deploy"], authEnv, serverDir());
    const urlMatch = deployOutput.stdout.match(/https:\/\/[\w.-]+\.workers\.dev/);
    workerUrl = urlMatch?.[0] ?? "";
    debug("deploy completed workerUrl=%s", workerUrl || "<not parsed>");
    deploySpinner.succeed(
      `Worker ${workerExists ? "redeployed" : "deployed"}${workerUrl ? `: ${bold(workerUrl)}` : ""}`
    );
  } catch (err: any) {
    deploySpinner.fail(`Worker deployment failed: ${err.message}`);
    process.exit(1);
  }

  // Resolve database_id from the live worker bindings.
  // Always reads from Cloudflare — local wrangler.jsonc cannot be trusted
  // since another machine or team member may have redeployed.
  const d1Spinner = ora("Resolving D1 database binding...").start();
  let databaseId: string;
  let ephemeralConfigPath: string;
  try {
    databaseId = await resolveD1DatabaseId(authEnv);
    ephemeralConfigPath = buildEphemeralConfig(databaseId);
    d1Spinner.succeed(`D1 database resolved (id: ${dim(databaseId)})`);
  } catch (err: any) {
    d1Spinner.fail(`Failed to resolve D1 database: ${err.message}`);
    process.exit(1);
  }

  // masterKeyToDisplay is set inside the try block below and read in the
  // summary block after — declared here so it survives the try/finally scope.
  let masterKeyToDisplay: string | undefined;

  try {
    // ── Step 4: Ensure MASTER_KEY exists (never overwrite)
    const checkSecretSpinner = ora("Checking Worker secrets...").start();
    const hasExistingMasterKey = await workerHasMasterKeySecret(authEnv);
    checkSecretSpinner.succeed(
      hasExistingMasterKey
        ? "Found existing MASTER_KEY secret"
        : "No MASTER_KEY secret found"
    );

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
          wranglerBin(),
          ["secret", "put", "MASTER_KEY"],
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
      } catch (err: any) {
        secretSpinner.fail(`Failed to push master key: ${err.message}`);
        process.exit(1);
      }
    }

    // ── Step 5: Run D1 migrations via the ephemeral config
    //
    // The ephemeral config contains the resolved database_id, so wrangler can
    // identify the correct remote database without touching wrangler.jsonc.
    const migrateSpinner = ora("Running database migrations...").start();
    try {
      await wrangler(
        ["d1", "migrations", "apply", "keyflare", "--remote", "-c", ephemeralConfigPath],
        authEnv,
        serverDir()
      );
      debug("migrations apply completed");
      migrateSpinner.succeed("Database migrations applied");
    } catch (err: any) {
      if (
        err.message.includes("already been applied") ||
        err.message.includes("No migrations to apply")
      ) {
        migrateSpinner.succeed("Database schema already up to date");
      } else {
        migrateSpinner.fail(`Migrations failed: ${err.message}`);
        process.exit(1);
      }
    }
  } finally {
    // Best-effort cleanup of the ephemeral config.
    // Note: process.exit() bypasses finally — acceptable since the OS reclaims
    // temp files. For all normal (non-exit) paths this runs correctly.
    try {
      fs.unlinkSync(ephemeralConfigPath);
      debug("ephemeral config deleted: %s", ephemeralConfigPath);
    } catch {
      // ignore
    }
  }

  // ── Step 6: Bootstrap — create first admin key (skipped if already done)
  const bootstrapSpinner = ora("Creating user key...").start();
  const apiUrl = workerUrl || `https://keyflare.workers.dev`;
  debug("bootstrap using apiUrl=%s", apiUrl);

  // Temporarily set the API URL to bootstrap
  process.env.KEYFLARE_API_URL = apiUrl;

  let adminKey: string | undefined;
  try {
    const data = await api.post<BootstrapResponse>("/bootstrap");
    adminKey = data.key;
    debug("bootstrap created admin key (%s)", redact(adminKey));
    bootstrapSpinner.succeed("User key created");
  } catch (err: any) {
    if (err instanceof KeyflareApiError && err.code === "CONFLICT") {
      // Normal on re-runs of kfl init — the instance is already initialised.
      bootstrapSpinner.succeed("Instance already initialised — existing API keys preserved");
    } else {
      bootstrapSpinner.fail(`Bootstrap failed: ${err.message}`);
      process.exit(1);
    }
  }

  // ── Step 7: Save config
  const existingConfig = readConfig();
  writeConfig({ apiUrl, project: existingConfig.project, environment: existingConfig.environment });
  if (adminKey) {
    writeApiKey(adminKey);
  }
  debug("config written; adminKeySaved=%s", Boolean(adminKey));

  log("");
  success(bold("✓ Keyflare deployed successfully!"));

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
    if (!options.yes) {
      await confirm({ message: "I have saved the master key", default: false });
    }
  } else {
    log(dim("MASTER_KEY already exists on the worker and was left unchanged.\n"));
  }

  if (adminKey) {
    warn(bold("⚠️  IMPORTANT: Your user key\n"));
    log(
      dim(
        "This key is required for `kfl login`. It has been saved to\n" +
          "~/.config/keyflare/credentials, but you should back it up securely.\n" +
          "If lost, recovery requires manual database operations.\n"
      )
    );
  }

  log(dim(`\nAPI URL: ${apiUrl}`));
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
