import fs from "node:fs";
import { spawnSync } from "node:child_process";
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

function secretsUrl(project: string, config: string) {
  return `/projects/${project}/configs/${config}/secrets`;
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function runSecretsList(project: string, config: string) {
  const data = await api.get<GetSecretsResponse>(secretsUrl(project, config));
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
  config: string
) {
  const data = await api.get<GetSecretsResponse>(secretsUrl(project, config));
  const value = data.secrets[key];
  if (value === undefined) {
    error(`Secret "${key}" not found in ${project}/${config}`);
    process.exit(4);
  }
  log(value);
}

// ─── Set ──────────────────────────────────────────────────────────────────────

export async function runSecretsSet(
  pairs: string[],
  project: string,
  config: string
) {
  const set: Record<string, string> = {};
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx === -1) {
      error(`Invalid format "${pair}" — expected KEY=VALUE`);
      process.exit(1);
    }
    set[pair.slice(0, idx)] = pair.slice(idx + 1);
  }

  await api.patch<PatchSecretsResponse>(secretsUrl(project, config), { set });
  success(`Set ${Object.keys(set).length} secret(s) in ${project}/${config}`);
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function runSecretsDelete(
  key: string,
  project: string,
  config: string
) {
  await api.patch<PatchSecretsResponse>(secretsUrl(project, config), {
    delete: [key],
  });
  success(`Deleted secret "${key}" from ${project}/${config}`);
}

// ─── Upload ───────────────────────────────────────────────────────────────────

export async function runUpload(
  file: string,
  project: string,
  config: string,
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
        secretsUrl(project, config)
      );
      currentCount = Object.keys(current.secrets).length;
    } catch {
      // ignore — might be a new config
    }

    const confirmed = await confirm({
      message: `This will REPLACE all ${currentCount} secret(s) in ${project}/${config} with ${count} secret(s) from ${file}. Continue?`,
      default: false,
    });
    if (!confirmed) {
      error("Aborted.");
      process.exit(1);
    }
  }

  const data = await api.put<SetSecretsResponse>(secretsUrl(project, config), {
    secrets,
  });
  success(`Uploaded ${data.count} secret(s) to ${project}/${config}`);
}

// ─── Download ─────────────────────────────────────────────────────────────────

export async function runDownload(
  project: string,
  config: string,
  opts: { format?: string; output?: string }
) {
  const data = await api.get<GetSecretsResponse>(secretsUrl(project, config));
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

export async function runRun(
  project: string,
  config: string,
  cmd: string[]
) {
  if (cmd.length === 0) {
    error("No command provided. Usage: kfl run --project <p> --config <c> -- <command>");
    process.exit(1);
  }

  const data = await api.get<GetSecretsResponse>(secretsUrl(project, config));
  const env = { ...process.env, ...data.secrets };

  const result = spawnSync(cmd[0], cmd.slice(1), {
    env,
    stdio: "inherit",
    shell: false,
  });

  process.exit(result.status ?? 0);
}
