import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeDebug, redact } from "./debug.js";

const CONFIG_DIR = path.join(os.homedir(), ".config", "keyflare");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.yaml");
const CREDENTIALS_FILE = path.join(CONFIG_DIR, "credentials");
const debug = makeDebug("config");

export interface KeyflareConfig {
  apiUrl: string;
  project?: string;
  environment?: string;
}

function ensureConfigDir() {
  debug("ensure config dir: %s", CONFIG_DIR);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

export function readConfig(): Partial<KeyflareConfig> {
  try {
    debug("reading config: %s", CONFIG_FILE);
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    const config: Partial<KeyflareConfig> = {};
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;

      const m = trimmed.match(/^(api_url|project|environment)\s*:\s*(.+)$/);
      if (!m) continue;

      const [, key, rawValue] = m;
      const value = parseYamlScalar(rawValue);

      if (key === "api_url") config.apiUrl = value;
      if (key === "project") config.project = value;
      if (key === "environment") config.environment = value;
    }
    debug("config loaded: apiUrl=%s project=%s environment=%s", config.apiUrl, config.project, config.environment);
    return config;
  } catch {
    debug("config not found or unreadable: %s", CONFIG_FILE);
    return {};
  }
}

export function writeConfig(config: KeyflareConfig) {
  debug("writing config: apiUrl=%s project=%s environment=%s", config.apiUrl, config.project, config.environment);
  ensureConfigDir();
  const lines = [`api_url: ${yamlQuote(config.apiUrl)}`];
  if (config.project) lines.push(`project: ${yamlQuote(config.project)}`);
  if (config.environment) lines.push(`environment: ${yamlQuote(config.environment)}`);
  fs.writeFileSync(CONFIG_FILE, lines.join("\n") + "\n", "utf8");
}

function yamlQuote(value: string): string {
  return JSON.stringify(value);
}

function parseYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

export function readApiKey(): string | undefined {
  // Env var takes highest precedence
  if (process.env.KEYFLARE_API_KEY) {
    debug("using API key from env KEYFLARE_API_KEY (%s)", redact(process.env.KEYFLARE_API_KEY));
    return process.env.KEYFLARE_API_KEY;
  }
  try {
    const key = fs.readFileSync(CREDENTIALS_FILE, "utf8").trim();
    debug("using API key from credentials file (%s)", redact(key));
    return key;
  } catch {
    debug("no API key found in env or credentials file");
    return undefined;
  }
}

export function writeApiKey(key: string) {
  debug("writing credentials file with API key (%s)", redact(key));
  ensureConfigDir();
  fs.writeFileSync(CREDENTIALS_FILE, key + "\n", { mode: 0o600 });
}

export function getApiUrl(): string {
  if (process.env.KEYFLARE_API_URL) {
    debug("using API URL from env: %s", process.env.KEYFLARE_API_URL);
    return process.env.KEYFLARE_API_URL;
  }
  const config = readConfig();
  const url = config.apiUrl ?? "http://localhost:8787";
  debug("resolved API URL: %s", url);
  return url;
}

export function isLocalMode(): boolean {
  return (
    process.env.KEYFLARE_LOCAL === "true" ||
    getApiUrl().startsWith("http://localhost")
  );
}
