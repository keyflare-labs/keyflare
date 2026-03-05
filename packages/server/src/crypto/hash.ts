/**
 * SHA-256 hash of a string → hex.
 * Used for hashing API keys.
 */
export async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return arrayBufferToHex(hash);
}

/**
 * HMAC-SHA256 of a string using a CryptoKey → hex.
 * Used for deterministic lookups (project names, env names, secret keys).
 */
export async function hmacSha256(
  key: CryptoKey,
  input: string
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return arrayBufferToHex(sig);
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}
