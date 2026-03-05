const IV_LENGTH = 12; // 96-bit IV for AES-GCM

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns base64(iv || ciphertext || tag).
 */
export async function encrypt(
  key: CryptoKey,
  plaintext: string
): Promise<string> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const data = encoder.encode(plaintext);

  const ciphertextWithTag = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );

  // Combine iv + ciphertext+tag
  const combined = new Uint8Array(
    iv.byteLength + ciphertextWithTag.byteLength
  );
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertextWithTag), iv.byteLength);

  return arrayBufferToBase64(combined.buffer);
}

/**
 * Decrypt a base64(iv || ciphertext || tag) string with AES-256-GCM.
 */
export async function decrypt(
  key: CryptoKey,
  stored: string
): Promise<string> {
  const raw = base64ToUint8Array(stored);

  const iv = raw.slice(0, IV_LENGTH);
  const ciphertextWithTag = raw.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertextWithTag
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
