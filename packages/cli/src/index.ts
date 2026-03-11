#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { runInit, killActiveChild } from "./commands/init.js";
import { runLogin } from "./commands/login.js";
import {
  runProjectsList,
  runProjectsCreate,
  runProjectsDelete,
} from "./commands/projects.js";
import {
  runEnvironmentsList,
  runEnvironmentsCreate,
  runEnvironmentsDelete,
} from "./commands/environments.js";
import {
  runSecretsList,
  runSecretsGet,
  runSecretsSet,
  runSecretsDelete,
  runUpload,
  runDownload,
  runRun,
} from "./commands/secrets.js";
import {
  runKeysList,
  runKeysCreate,
  runKeysRevoke,
  runKeysUpdate,
} from "./commands/keys.js";
import { readConfig } from "./config.js";
import { error } from "./output/log.js";
import { makeDebug } from "./debug.js";

const program = new Command();
const debug = makeDebug("index");
let cachedDefaultConfig: ReturnType<typeof readConfig> | undefined;

function readDefaultConfig(): ReturnType<typeof readConfig> {
  if (!cachedDefaultConfig) {
    cachedDefaultConfig = readConfig();
  }
  return cachedDefaultConfig;
}

debug("argv=%o", process.argv.slice(2));
debug("DEBUG=%s", process.env.DEBUG ?? "<unset>");

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);

program
  .name("kfl")
  .description("Keyflare — open-source secrets manager on Cloudflare")
  .version(pkg.version)
  .allowExcessArguments(false)
  .showHelpAfterError(true);

// ─── kfl init ────────────────────────────────────────────────
program
  .command("init")
  .description(
    "Bootstrap a new Keyflare deployment on Cloudflare. " +
      "Supports OAuth (browser) and API token authentication."
  )
  .option("-y, --yes", "Skip confirmation prompts (auto-accept)")
  .option(
    "--name <name>",
    "Worker and database name (default: keyflare). Must be alphanumeric with hyphens, max 63 chars."
  )
  .option(
    "--d1id <uuid>",
    "Bind to an existing D1 database by UUID. If not provided, a new database is created automatically."
  )
  .option(
    "--master-key <key>",
    "Custom master key (base64-encoded 256-bit key). If not provided, a random key is generated. " +
      "Example: K7gNU3sdo+OL0wNhqoVWhr3g6s1xYv72ol/pe/Unols="
  )
  .action(async (opts) => {
    await runInit(opts).catch(handleError);
  });

// ─── kfl login ───────────────────────────────────────────────
program
  .command("login")
  .description(
    "Log in to an existing Keyflare deployment. " +
      "Prompts for the API URL and your API key."
  )
  .action(async () => {
    await runLogin().catch(handleError);
  });

// ─── kfl projects ────────────────────────────────────────────
const projects = program
  .command("projects")
  .description("Manage projects")
  .action(() => projects.help());

projects
  .command("list")
  .description("List all projects")
  .action(async () => {
    await runProjectsList().catch(handleError);
  });

projects
  .command("create <name>")
  .description("Create a new project")
  .option(
    "--environmentless",
    "Create project without default Dev/Prod environments",
  )
  .action(async (name: string, opts) => {
    await runProjectsCreate(name, opts).catch(handleError);
  });

projects
  .command("delete <name>")
  .description("Delete a project and all its environments and secrets")
  .option("--force", "Skip confirmation prompt")
  .action(async (name: string, opts) => {
    await runProjectsDelete(name, opts).catch(handleError);
  });

// ─── kfl environments (alias: env) ─────────────────────────────
const environments = program
  .command("environments")
  .alias("env")
  .description("Manage environments within a project")
  .action(() => environments.help());

environments
  .command("list")
  .description("List all environments in a project")
  .requiredOption("--project <name>", "Project name", resolveProject())
  .action(async (opts) => {
    await runEnvironmentsList(opts.project).catch(handleError);
  });

environments
  .command("create <name>")
  .description("Create a new environment in a project")
  .requiredOption("--project <name>", "Project name", resolveProject())
  .action(async (name: string, opts) => {
    await runEnvironmentsCreate(name, opts.project).catch(handleError);
  });

environments
  .command("delete <name>")
  .description("Delete an environment and all its secrets")
  .requiredOption("--project <name>", "Project name", resolveProject())
  .option("--force", "Skip confirmation prompt")
  .action(async (name: string, opts) => {
    await runEnvironmentsDelete(name, opts.project, opts).catch(handleError);
  });

// ─── kfl secrets ─────────────────────────────────────────────
const secrets = program
  .command("secrets")
  .description("Manage secrets within an environment")
  .action(() => secrets.help());

secrets
  .command("list")
  .description("List secret keys (values hidden)")
  .requiredOption("--project <name>", "Project name", resolveProject())
  .requiredOption("--env <name>", "Environment name", resolveEnvironment())
  .action(async (opts) => {
    await runSecretsList(opts.project, opts.env).catch(handleError);
  });

secrets
  .command("get <key>")
  .description("Print a single secret value to stdout")
  .requiredOption("--project <name>", "Project name", resolveProject())
  .requiredOption("--env <name>", "Environment name", resolveEnvironment())
  .action(async (key: string, opts) => {
    await runSecretsGet(key, opts.project, opts.env).catch(handleError);
  });

secrets
  .command("set <pairs...>")
  .description("Set one or more secrets (KEY=VALUE ...)")
  .requiredOption("--project <name>", "Project name", resolveProject())
  .requiredOption("--env <name>", "Environment name", resolveEnvironment())
  .action(async (pairs: string[], opts) => {
    await runSecretsSet(pairs, opts.project, opts.env).catch(handleError);
  });

secrets
  .command("delete <key>")
  .description("Delete a secret")
  .requiredOption("--project <name>", "Project name", resolveProject())
  .requiredOption("--env <name>", "Environment name", resolveEnvironment())
  .action(async (key: string, opts) => {
    await runSecretsDelete(key, opts.project, opts.env).catch(handleError);
  });

// ─── kfl upload ──────────────────────────────────────────────
program
  .command("upload <file>")
  .description(
    "Upload a .env file — REPLACES all secrets in the target environment"
  )
  .requiredOption("--project <name>", "Project name", resolveProject())
  .requiredOption("--env <name>", "Environment name", resolveEnvironment())
  .option("--force", "Skip confirmation prompt")
  .action(async (file: string, opts) => {
    await runUpload(file, opts.project, opts.env, opts).catch(handleError);
  });

// ─── kfl download ────────────────────────────────────────────
program
  .command("download")
  .description("Download secrets to stdout or a file")
  .requiredOption("--project <name>", "Project name", resolveProject())
  .requiredOption("--env <name>", "Environment name", resolveEnvironment())
  .option("--format <fmt>", "Output format: env, json, yaml, shell", "env")
  .option("--output <file>", "Write to file instead of stdout")
  .action(async (opts) => {
    await runDownload(opts.project, opts.env, opts).catch(handleError);
  });

// ─── kfl run ─────────────────────────────────────────────────
program
  .command("run")
  .description("Run a command with secrets injected as environment variables")
  .requiredOption("--project <name>", "Project name", resolveProject())
  .requiredOption("--env <name>", "Environment name", resolveEnvironment())
  .allowUnknownOption()
  .argument("[cmd...]", "Command and arguments (after --)")
  .action(async (cmd: string[], opts: { project: string; env: string }) => {
    await runRun(opts.project, opts.env, cmd).catch(handleError);
  });

// ─── kfl keys ────────────────────────────────────────────────
const keys = program
  .command("keys")
  .description("Manage API keys")
  .action(() => keys.help());

keys
  .command("list")
  .description("List all API keys")
  .action(async () => {
    await runKeysList().catch(handleError);
  });

keys
  .command("create")
  .description(
    "Create a new API key.\n\n" +
      "USER KEYS (kfl_user_*) — Full admin access.\n" +
      "  - Can manage all projects, environments, secrets, and other API keys.\n" +
      "  - No scoping required — has access to everything.\n" +
      "  - Required flags: --type user --label <label>\n\n" +
      "SYSTEM KEYS (kfl_sys_*) — Scoped access for CI/CD and automation.\n" +
      "  - Can only access specific project/environment combinations.\n" +
      "  - Required flags: --type system --label <label> --scope <project:env> --permission <read|readwrite>\n" +
      "  - Use --scope multiple times for multiple project:env pairs.\n" +
      "  - Use * as environment wildcard (e.g., --scope my-api:*)"
  )
  .requiredOption("--type <type>", "Key type: user or system")
  .requiredOption("--label <label>", "Human-readable label")
  .option(
    "--scope <scope>",
    "Scope for system keys: project:environment (repeatable). Required for system keys.",
    collect,
    []
  )
  .option(
    "--permission <perm>",
    "Permission for system keys: read or readwrite. Required for system keys."
  )
  .action(async (opts) => {
    await runKeysCreate(opts).catch(handleError);
  });

keys
  .command("revoke <prefix>")
  .description("Revoke an API key by its prefix")
  .action(async (prefix: string) => {
    await runKeysRevoke(prefix).catch(handleError);
  });

keys
  .command("put <prefix>")
  .description(
    "Update the scopes and permission of a system key.\n\n" +
      "This replaces ALL existing scopes with the new set. Use `kfl keys list` to see current scopes.\n\n" +
      "Examples:\n" +
      "  kfl keys put kfl_sys_abc123 --scope my-api:production --permission read\n" +
      "  kfl keys put kfl_sys_abc123 --scope my-api:* --scope frontend:* --permission readwrite"
  )
  .requiredOption(
    "--scope <scope>",
    "Scope: project:environment (repeatable). Replaces all existing scopes.",
    collect,
    []
  )
  .requiredOption(
    "--permission <perm>",
    "Permission: read or readwrite"
  )
  .action(async (prefix: string, opts) => {
    await runKeysUpdate(prefix, opts).catch(handleError);
  });

// ─── Helpers ─────────────────────────────────────────────────

/** Read project default from env or config file (used as Commander default). */
function resolveProject(): string | undefined {
  if (process.env.KEYFLARE_PROJECT) return process.env.KEYFLARE_PROJECT;
  return readDefaultConfig().project;
}

/** Read environment default from env or config file. */
function resolveEnvironment(): string | undefined {
  if (process.env.KEYFLARE_ENV) return process.env.KEYFLARE_ENV;
  return readDefaultConfig().environment;
}

/** Collector for repeatable options (--scope a --scope b → [a, b]). */
function collect(val: string, prev: string[]): string[] {
  return prev.concat(val);
}

function handleError(err: unknown) {
  debug("command failed: %o", err);
  if (err instanceof Error) {
    error(err.message);
  } else {
    error(String(err));
  }
  process.exit(1);
}

// Clean exit on Ctrl+C.
//
// When run via `pnpm kfl …`, pnpm/tsx intercept SIGINT before our
// process.on("SIGINT") handler ever fires. Work around this by killing
// active child processes directly.
process.on("SIGINT", () => {
  killActiveChild();
  // Show cursor (ora hides it)
  process.stderr.write("\x1B[?25h");
  process.exit(130);
});

// Show help (exit 0) when no arguments are provided
if (process.argv.length <= 2) {
  program.help();
}

program.parse();
