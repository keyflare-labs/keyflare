#!/usr/bin/env node
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runDevServer, runDevInit } from "./commands/dev.js";
import {
  runProjectsList,
  runProjectsCreate,
  runProjectsDelete,
} from "./commands/projects.js";
import {
  runConfigsList,
  runConfigsCreate,
  runConfigsDelete,
} from "./commands/configs.js";
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
} from "./commands/keys.js";
import { readConfig } from "./config.js";
import { error } from "./output/log.js";

const program = new Command();

program
  .name("kfl")
  .description("Keyflare — open-source secrets manager on Cloudflare")
  .version("0.1.0");

// ─── kfl init ────────────────────────────────────────────────
program
  .command("init")
  .description(
    "Bootstrap a new Keyflare deployment on Cloudflare. " +
      "Supports OAuth (browser) and API token authentication."
  )
  .option("--force", "Re-run even if already initialised")
  .action(async (opts) => {
    await runInit(opts).catch(handleError);
  });

// ─── kfl dev ─────────────────────────────────────────────────
const dev = program
  .command("dev")
  .description("Local development helpers (no Cloudflare account required)");

dev
  .command("init")
  .description(
    "Set up a local Keyflare instance. Generates a local master key, " +
      "applies migrations, bootstraps the DB, and saves credentials " +
      "pointing at http://localhost:8787.\n\n" +
      "Set KEYFLARE_LOCAL=true to make all other kfl commands use localhost."
  )
  .option("--force", "Regenerate the local master key")
  .action(async (opts) => {
    await runDevInit(opts).catch(handleError);
  });

dev
  .command("server")
  .description(
    "Start the Keyflare server locally via wrangler dev (port 8787).\n" +
      "Run `kfl dev init` first to set up the local database."
  )
  .option("--port <port>", "Port to listen on", "8787")
  .action(async (opts) => {
    await runDevServer({ port: parseInt(opts.port, 10) }).catch(handleError);
  });

// ─── kfl projects ────────────────────────────────────────────
const projects = program
  .command("projects")
  .description("Manage projects");

projects
  .command("list")
  .description("List all projects")
  .action(async () => {
    await runProjectsList().catch(handleError);
  });

projects
  .command("create <name>")
  .description("Create a new project")
  .action(async (name: string) => {
    await runProjectsCreate(name).catch(handleError);
  });

projects
  .command("delete <name>")
  .description("Delete a project and all its environments and secrets")
  .option("--force", "Skip confirmation prompt")
  .action(async (name: string, opts) => {
    await runProjectsDelete(name, opts).catch(handleError);
  });

// ─── kfl configs ─────────────────────────────────────────────
const configs = program
  .command("configs")
  .description("Manage configs (environments) within a project");

configs
  .command("list")
  .description("List all configs in a project")
  .requiredOption("--project <name>", "Project name", resolveProject())
  .action(async (opts) => {
    await runConfigsList(opts.project).catch(handleError);
  });

configs
  .command("create <name>")
  .description("Create a new config in a project")
  .requiredOption("--project <name>", "Project name", resolveProject())
  .action(async (name: string, opts) => {
    await runConfigsCreate(name, opts.project).catch(handleError);
  });

configs
  .command("delete <name>")
  .description("Delete a config and all its secrets")
  .requiredOption("--project <name>", "Project name", resolveProject())
  .option("--force", "Skip confirmation prompt")
  .action(async (name: string, opts) => {
    await runConfigsDelete(name, opts.project, opts).catch(handleError);
  });

// ─── kfl secrets ─────────────────────────────────────────────
const secrets = program
  .command("secrets")
  .description("Manage secrets within a config");

secrets
  .command("list")
  .description("List secret keys (values hidden)")
  .requiredOption("--project <name>", "Project name", resolveProject())
  .requiredOption("--config <env>", "Config / environment name", resolveConfig())
  .action(async (opts) => {
    await runSecretsList(opts.project, opts.config).catch(handleError);
  });

secrets
  .command("get <key>")
  .description("Print a single secret value to stdout")
  .requiredOption("--project <name>", "Project name", resolveProject())
  .requiredOption("--config <env>", "Config / environment name", resolveConfig())
  .action(async (key: string, opts) => {
    await runSecretsGet(key, opts.project, opts.config).catch(handleError);
  });

secrets
  .command("set <pairs...>")
  .description("Set one or more secrets (KEY=VALUE ...)")
  .requiredOption("--project <name>", "Project name", resolveProject())
  .requiredOption("--config <env>", "Config / environment name", resolveConfig())
  .action(async (pairs: string[], opts) => {
    await runSecretsSet(pairs, opts.project, opts.config).catch(handleError);
  });

secrets
  .command("delete <key>")
  .description("Delete a secret")
  .requiredOption("--project <name>", "Project name", resolveProject())
  .requiredOption("--config <env>", "Config / environment name", resolveConfig())
  .action(async (key: string, opts) => {
    await runSecretsDelete(key, opts.project, opts.config).catch(handleError);
  });

// ─── kfl upload ──────────────────────────────────────────────
program
  .command("upload <file>")
  .description(
    "Upload a .env file — REPLACES all secrets in the target config"
  )
  .requiredOption("--project <name>", "Project name", resolveProject())
  .requiredOption("--config <env>", "Config / environment name", resolveConfig())
  .option("--force", "Skip confirmation prompt")
  .action(async (file: string, opts) => {
    await runUpload(file, opts.project, opts.config, opts).catch(handleError);
  });

// ─── kfl download ────────────────────────────────────────────
program
  .command("download")
  .description("Download secrets to stdout or a file")
  .requiredOption("--project <name>", "Project name", resolveProject())
  .requiredOption("--config <env>", "Config / environment name", resolveConfig())
  .option("--format <fmt>", "Output format: env, json, yaml, shell", "env")
  .option("--output <file>", "Write to file instead of stdout")
  .action(async (opts) => {
    await runDownload(opts.project, opts.config, opts).catch(handleError);
  });

// ─── kfl run ─────────────────────────────────────────────────
program
  .command("run")
  .description("Run a command with secrets injected as environment variables")
  .requiredOption("--project <name>", "Project name", resolveProject())
  .requiredOption("--config <env>", "Config / environment name", resolveConfig())
  .allowUnknownOption()
  .argument("[cmd...]", "Command and arguments (after --)")
  .action(async (cmd: string[], opts: { project: string; config: string }) => {
    await runRun(opts.project, opts.config, cmd).catch(handleError);
  });

// ─── kfl keys ────────────────────────────────────────────────
const keys = program.command("keys").description("Manage API keys");

keys
  .command("list")
  .description("List all API keys")
  .action(async () => {
    await runKeysList().catch(handleError);
  });

keys
  .command("create")
  .description("Create a new API key")
  .requiredOption("--type <type>", "Key type: user or system")
  .requiredOption("--label <label>", "Human-readable label")
  .option(
    "--scope <scope>",
    "Scope for system keys: project:environment (repeatable)",
    collect,
    []
  )
  .option("--permission <perm>", "Permission for system keys: read or readwrite")
  .action(async (opts) => {
    await runKeysCreate(opts).catch(handleError);
  });

keys
  .command("revoke <prefix>")
  .description("Revoke an API key by its prefix")
  .action(async (prefix: string) => {
    await runKeysRevoke(prefix).catch(handleError);
  });

// ─── Helpers ─────────────────────────────────────────────────

/** Read project default from env or config file (used as Commander default). */
function resolveProject(): string | undefined {
  if (process.env.KEYFLARE_PROJECT) return process.env.KEYFLARE_PROJECT;
  return readConfig().project;
}

/** Read config/environment default from env or config file. */
function resolveConfig(): string | undefined {
  if (process.env.KEYFLARE_CONFIG) return process.env.KEYFLARE_CONFIG;
  return readConfig().environment;
}

/** Collector for repeatable options (--scope a --scope b → [a, b]). */
function collect(val: string, prev: string[]): string[] {
  return prev.concat(val);
}

function handleError(err: unknown) {
  if (err instanceof Error) {
    error(err.message);
  } else {
    error(String(err));
  }
  process.exit(1);
}

program.parse();
