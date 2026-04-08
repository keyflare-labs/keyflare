import fs from "node:fs";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type {
  GetSecretsResponse,
  SetSecretsResponse,
  PatchSecretsResponse,
} from "@keyflare/shared";
import { api } from "../api/client.js";
import { success, error, log, dim, bold } from "../output/log.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length) {
    let line = lines[i].trimEnd();

    // skip blank lines and comments
    if (!line || line.startsWith("#")) {
      i++;
      continue;
    }

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) {
      i++;
      continue;
    }

    const key = line.slice(0, eqIdx).trim();
    let rawValue = line.slice(eqIdx + 1).trim();

    // multi-line quoted value
    if ((rawValue.startsWith('"') && !rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && !rawValue.endsWith("'"))) {
      const quoteChar = rawValue[0];
      let value = rawValue.slice(1);
      i++;
      while (i < lines.length) {
        const nextLine = lines[i].trimEnd();
        if (nextLine.endsWith(quoteChar)) {
          value += "\n" + nextLine.slice(0, -1);
          break;
        }
        value += "\n" + nextLine;
        i++;
      }
      result[key] = value;
    } else {
      // strip surrounding quotes (single-line)
      if (
        (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'"))
      ) {
        rawValue = rawValue.slice(1, -1);
      }
      result[key] = rawValue;
    }
    i++;
  }
  return result;
}

function secretsUrl(project: string, environment: string) {
  return `/projects/${project}/environments/${environment}/secrets`;
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function runSecretsList(project: string, environment: string) {
  const data = await api.get<GetSecretsResponse>(secretsUrl(project, environment));
  const keys = Object.keys(data.secrets);

  if (keys.length === 0) {
    console.log(dim("No secrets found."));
    return;
  }

  const keyW = Math.max(3, ...keys.map((k) => k.length));
  console.log(bold(`${"KEY".padEnd(keyW)}  VALUE`));
  for (const k of keys.sort()) {
    console.log(`${k.padEnd(keyW)}  ****`);
  }
}

// ─── Get ──────────────────────────────────────────────────────────────────────

export async function runSecretsGet(
  key: string,
  project: string,
  environment: string
) {
  const data = await api.get<GetSecretsResponse>(secretsUrl(project, environment));
  const value = data.secrets[key];
  if (value === undefined) {
    error(`Secret "${key}" not found in ${project}/${environment}`);
    process.exit(4);
  }
  log(value);
}

// ─── Set ──────────────────────────────────────────────────────────────────────

export async function runSecretsSet(
  pairs: string[],
  project: string,
  environment: string
) {
  const set: Record<string, string> = {};
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx === -1) {
      // No "=" found — treat the whole arg as a key name and prompt for value
      const { password } = await import("@inquirer/prompts");
      const value = await password({
        message: `Enter value for ${pair}`,
      });
      set[pair] = value;
    } else {
      set[pair.slice(0, idx)] = pair.slice(idx + 1);
    }
  }

  await api.patch<PatchSecretsResponse>(secretsUrl(project, environment), { set });
  success(`Set ${Object.keys(set).length} secret(s) in ${project}/${environment}`);
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function runSecretsDelete(
  key: string,
  project: string,
  environment: string
) {
  const data = await api.patch<PatchSecretsResponse>(secretsUrl(project, environment), {
    delete: [key],
  });
  if (data.deleted === 0) {
    error(`Secret "${key}" not found in ${project}/${environment}`);
    process.exit(4);
  }
  success(`Deleted secret "${key}" from ${project}/${environment}`);
}

// ─── Upload ───────────────────────────────────────────────────────────────────

export async function runUpload(
  file: string,
  project: string,
  environment: string,
  opts: { force?: boolean }
) {
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    error(`Cannot read file: ${file}`);
    process.exit(1);
  }

  const secrets = parseEnvFile(content);
  const count = Object.keys(secrets).length;

  if (!opts.force) {
    const { confirm } = await import("@inquirer/prompts");

    // Fetch current count for the warning message
    let currentCount = 0;
    try {
      const current = await api.get<GetSecretsResponse>(
        secretsUrl(project, environment)
      );
      currentCount = Object.keys(current.secrets).length;
    } catch {
      // ignore — might be a new environment
    }

    const confirmed = await confirm({
      message: `This will REPLACE all ${currentCount} secret(s) in ${project}/${environment} with ${count} secret(s) from ${file}. Continue?`,
      default: false,
    });
    if (!confirmed) {
      error("Aborted.");
      process.exit(1);
    }
  }

  const data = await api.put<SetSecretsResponse>(secretsUrl(project, environment), {
    secrets,
  });
  success(`Uploaded ${data.count} secret(s) to ${project}/${environment}`);
}

// ─── Download ─────────────────────────────────────────────────────────────────

export async function runDownload(
  project: string,
  environment: string,
  opts: { format?: string; output?: string }
) {
  const data = await api.get<GetSecretsResponse>(secretsUrl(project, environment));
  const secrets = data.secrets;
  const fmt = opts.format ?? "env";

  let output: string;
  switch (fmt) {
    case "json":
      output = JSON.stringify(secrets, null, 2) + "\n";
      break;
    case "yaml":
      output =
        Object.entries(secrets)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n") + "\n";
      break;
    case "shell":
      output =
        Object.entries(secrets)
          .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
          .join("\n") + "\n";
      break;
    default: // env
      output =
        Object.entries(secrets)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n") + "\n";
  }

  if (opts.output) {
    fs.writeFileSync(opts.output, output, "utf8");
    success(
      `Written ${Object.keys(secrets).length} secret(s) to ${opts.output}`
    );
  } else {
    process.stdout.write(output);
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

/** Currently running child process — exported so the SIGINT handler can kill it. */
let activeRunChild: ChildProcess | null = null;

export function killActiveRunChild(): void {
  if (activeRunChild?.pid) {
    try {
      process.kill(-activeRunChild.pid, "SIGKILL");
    } catch {
      try { activeRunChild.kill("SIGKILL"); } catch { /* already gone */ }
    }
    activeRunChild = null;
  }
}

export async function runRun(
  project: string,
  environment: string,
  cmd: string[]
) {
  if (cmd.length === 0) {
    error("No command provided. Usage: kfl run --project <p> --env <e> -- <command> [args...]");
    process.exit(1);
  }

  // ── Fetch secrets and merge into env ─────────────────────────────────────
  const data = await api.get<GetSecretsResponse>(secretsUrl(project, environment));
  const env = { ...process.env, ...data.secrets };

  // ── Spawn via shell so $VAR references in args expand against injected env ─
  // We explicitly call the shell with -c flag to avoid Node.js DEP0190 warning.
  // This ensures proper argument escaping and security while maintaining support for
  // shell operators (pipes, redirects, &&, etc.) and environment variable expansion.
  const shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/sh');
  const commandString = cmd.join(' ');

  const child = spawn(shell, ['-c', commandString], {
    env,
    stdio: "inherit",
    // detached: new process group so we can kill the whole tree on SIGINT
    detached: true,
  });

  activeRunChild = child;

  await new Promise<void>((resolve) => {
    child.on("close", (code, signal) => {
      activeRunChild = null;
      if (signal) {
        // Mirror the signal-based exit code convention (128 + signal number)
        const sigNum: Record<string, number> = { SIGINT: 2, SIGTERM: 15, SIGKILL: 9 };
        process.exit(128 + (sigNum[signal] ?? 1));
      }
      process.exit(code ?? 0);
      resolve();
    });

    child.on("error", (err) => {
      activeRunChild = null;
      error(`Failed to run command: ${err.message}`);
      process.exit(1);
      resolve();
    });
  });
}
