import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { makeDebug } from "./debug.js";

const debug = makeDebug("wrangler");

/**
 * Resolve the wrangler binary path directly, avoiding npx/npm-exec which
 * adds intermediate processes that swallow SIGINT.
 */
export function wranglerBin(): string {
  const here = new URL(".", import.meta.url).pathname;

  // When published: wrangler is in CLI's node_modules (sibling to dist/)
  const publishedBinPath = path.join(here, "..", "node_modules", ".bin", "wrangler");
  if (fs.existsSync(publishedBinPath)) {
    debug("resolved wrangler binary (published): %s", publishedBinPath);
    return publishedBinPath;
  }

  // When in dev monorepo: wrangler is in server's node_modules
  const serverBinPath = path.join(here, "../../../server", "node_modules", ".bin", "wrangler");
  if (fs.existsSync(serverBinPath)) {
    debug("resolved wrangler binary (dev): %s", serverBinPath);
    return serverBinPath;
  }

  debug("wrangler binary not found, falling back to PATH");
  return "wrangler";
}

/**
 * Best-effort extraction of the Cloudflare account email from `wrangler whoami --json`.
 * Returns null if wrangler is not available or the email cannot be determined.
 */
export function getWranglerEmail(): string | null {
  try {
    const result = spawnSync(wranglerBin(), ["whoami", "--json"], {
      stdio: "pipe",
      timeout: 10_000,
    });

    if (result.status !== 0) {
      debug("wrangler whoami --json exited with status=%s", result.status);
      return null;
    }

    const raw = result.stdout?.toString() ?? "";
    const payload = JSON.parse(raw) as { email?: string };
    const email = payload.email ?? null;
    debug("wrangler email=%s", email ?? "<not found>");
    return email;
  } catch {
    debug("failed to get email from wrangler whoami --json");
    return null;
  }
}
