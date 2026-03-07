import { input, password } from "@inquirer/prompts";
import ora from "ora";
import { api, KeyflareApiError } from "../api/client.js";
import { writeConfig, writeApiKey, getApiUrl, readApiKey } from "../config.js";
import { log, error, bold, dim } from "../output/log.js";

export async function runLogin() {
  log(bold("\n🔑 Keyflare Login\n"));

  // Get current values
  const currentUrl = getApiUrl();
  const currentKey = readApiKey();

  // Show current config status
  const hasStoredUrl = !!currentUrl;
  const hasStoredKey = !!currentKey;
  if (hasStoredUrl || hasStoredKey) {
    log(dim("Current config:"));
    if (hasStoredUrl) log(dim(`  API URL: ${currentUrl}`));
    if (hasStoredKey) log(dim(`  API Key: ${maskKey(currentKey!)}`));
    log("");
    log(dim("Press Enter to keep current value.\n"));
  }

  // Prompt for API URL - allow empty to keep current
  const urlHint = hasStoredUrl ? ` (current: ${currentUrl})` : "";
  const rawUrl = await input({
    message: `Keyflare API URL${urlHint}`,
  });
  const apiUrl = rawUrl.trim() || (hasStoredUrl ? currentUrl : undefined);

  if (!apiUrl) {
    error("API URL is required (no current value to keep)");
    process.exit(1);
  }

  // Validate URL
  try {
    new URL(apiUrl);
  } catch {
    error("Please enter a valid URL");
    process.exit(1);
  }

  // Check if URL changed
  const urlChanged = apiUrl !== currentUrl;

  // Prompt for API key - allow empty to keep current
  const keyHint = hasStoredKey ? ` (current: ${maskKey(currentKey!)})` : "";
  const rawKey = await password({
    message: `API Key${keyHint}`,
  });
  const apiKey = rawKey.trim() || (hasStoredKey ? currentKey : undefined);

  if (!apiKey) {
    error("API key is required (no current value to keep)");
    process.exit(1);
  }

  // Check if key changed
  const keyChanged = apiKey !== currentKey;

  // If nothing changed, we're done
  if (!urlChanged && !keyChanged) {
    log(`\n${bold("✓ No changes")}\n`);
    return;
  }

  // Save URL immediately so API client can use it
  writeConfig({ apiUrl });

  // If only URL changed (key unchanged), skip verification since key was already verified
  if (!keyChanged) {
    log(`\n${bold("✓ API URL updated!")}\n\n${dim("API URL:")} ${apiUrl}\n`);
    return;
  }

  // Key changed - verify credentials
  // Temporarily set the API key for verification
  const originalEnvKey = process.env.KEYFLARE_API_KEY;
  process.env.KEYFLARE_API_KEY = apiKey;

  // Verify credentials by calling the API
  const spinner = ora("Verifying credentials...").start();
  try {
    await api.get("/keys");
    spinner.succeed("Credentials verified");
  } catch (err: any) {
    spinner.fail("Failed to verify credentials");
    // Restore original state
    if (originalEnvKey) {
      process.env.KEYFLARE_API_KEY = originalEnvKey;
    } else {
      delete process.env.KEYFLARE_API_KEY;
    }
    if (err instanceof KeyflareApiError) {
      if (err.status === 401) {
        error("Invalid API key");
      } else {
        error(`API error: ${err.message}`);
      }
    } else {
      error(err.message);
    }
    process.exit(1);
  }

  // Save the API key
  writeApiKey(apiKey);

  // Restore original env (the saved file will be used instead)
  if (originalEnvKey) {
    process.env.KEYFLARE_API_KEY = originalEnvKey;
  } else {
    delete process.env.KEYFLARE_API_KEY;
  }

  log(
    `\n${bold("✓ Logged in!")}\n\n${dim("API URL:")} ${apiUrl}\n${dim("Credentials saved to:")} ~/.config/keyflare/\n`
  );
}

/**
 * Mask a key for display, showing only prefix and length hint.
 * E.g., "kfl_user_abc123..." → "kfl_user_abc*** (36 chars)"
 */
function maskKey(key: string): string {
  if (!key) return "";
  const prefix = key.slice(0, 12);
  const rest = key.length > 12 ? "***" : "";
  return `${prefix}${rest} (${key.length} chars)`;
}
