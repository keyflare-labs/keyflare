import { HKDF_INFO_ENCRYPT, HKDF_INFO_HMAC } from "@keyflare/shared";
import type { DerivedKeys } from "../types.js";

/**
 * Import the raw MASTER_KEY string into a CryptoKey suitable for HKDF.
 */
async function importMasterKey(masterKeyString: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const raw = encoder.encode(masterKeyString);
  return crypto.subtle.importKey("raw", raw, { name: "HKDF" }, false, [
    "deriveKey",
  ]);
}

/**
 * Derive a sub-key from the master key using HKDF-SHA256.
 */
async function deriveKey(
  masterKey: CryptoKey,
  info: string,
  usage: KeyUsage[],
  algorithm: AesKeyGenParams | HmacKeyGenParams
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0), // no salt — master key is already high-entropy
      info: encoder.encode(info),
    },
    masterKey,
    algorithm,
    false,
    usage
  );
}

/**
 * Derive both the encryption key (AES-256-GCM) and HMAC key from MASTER_KEY.
 */
export async function deriveMasterKeys(
  masterKeyString: string
): Promise<DerivedKeys> {
  const masterKey = await importMasterKey(masterKeyString);

  const [encryptionKey, hmacKey] = await Promise.all([
    deriveKey(masterKey, HKDF_INFO_ENCRYPT, ["encrypt", "decrypt"], {
      name: "AES-GCM",
      length: 256,
    }),
    deriveKey(masterKey, HKDF_INFO_HMAC, ["sign", "verify"], {
      name: "HMAC",
      hash: "SHA-256",
      length: 256,
    } as HmacKeyGenParams),
  ]);

  return { encryptionKey, hmacKey };
}
