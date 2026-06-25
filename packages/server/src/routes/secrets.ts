import type {
  GetSecretsResponse,
  SetSecretsResponse,
  PatchSecretsResponse,
} from "@keyflare/shared";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { encrypt, decrypt } from "../crypto/encrypt.js";
import { hmacSha256 } from "../crypto/hash.js";
import {
  getSecretsByEnvironment,
  upsertSecret,
  deleteSecretByHash,
  deleteAllSecrets,
  countSecrets,
  updateSecretDescriptionByHash,
} from "../db/queries.js";
import type { AuthContext, DerivedKeys } from "../types.js";
import { jsonOk, jsonError } from "../utils.js";
import { hasScope, canWrite } from "../middleware/auth.js";
import { resolveProject, resolveEnvironment } from "./environments.js";
import type { SetSecretsInput, PatchSecretsInput } from "../validation/schemas.js";

export async function handleGetSecrets(
  request: Request,
  db: DrizzleD1Database,
  auth: AuthContext,
  derivedKeys: DerivedKeys,
  projectName: string,
  environmentName: string
): Promise<Response> {
  // Scope check
  if (auth.keyType === "system" && !hasScope(auth, projectName, environmentName)) {
    return jsonError("FORBIDDEN", "Key does not have access to this scope", 403);
  }

  const projectResult = await resolveProject(db, derivedKeys, projectName);
  if (projectResult instanceof Response) return projectResult;

  const envResult = await resolveEnvironment(
    db,
    derivedKeys,
    projectResult.id,
    environmentName
  );
  if (envResult instanceof Response) return envResult;

  const rows = await getSecretsByEnvironment(db, envResult.id);
  const secrets: Record<string, string> = {};
  const descriptions: Record<string, string> = {};

  for (const row of rows) {
    try {
      const key = await decrypt(derivedKeys.encryptionKey, row.keyEncrypted);
      const value = await decrypt(
        derivedKeys.encryptionKey,
        row.valueEncrypted
      );
      secrets[key] = value;
      if (row.descriptionEncrypted) {
        descriptions[key] = await decrypt(derivedKeys.encryptionKey, row.descriptionEncrypted);
      }
    } catch {
      // Skip corrupted secrets
    }
  }

  const response: GetSecretsResponse = { secrets };
  if (Object.keys(descriptions).length > 0) {
    response.descriptions = descriptions;
  }
  return jsonOk<GetSecretsResponse>(response);
}

export async function handleSetSecrets(
  _request: Request,
  db: DrizzleD1Database,
  auth: AuthContext,
  derivedKeys: DerivedKeys,
  projectName: string,
  environmentName: string,
  body: SetSecretsInput
): Promise<Response> {
  // Scope + write check
  if (auth.keyType === "system") {
    if (!hasScope(auth, projectName, environmentName)) {
      return jsonError(
        "FORBIDDEN",
        "Key does not have access to this scope",
        403
      );
    }
    if (!canWrite(auth)) {
      return jsonError("FORBIDDEN", "Key does not have write permission", 403);
    }
  }

  const projectResult = await resolveProject(db, derivedKeys, projectName);
  if (projectResult instanceof Response) return projectResult;

  const envResult = await resolveEnvironment(
    db,
    derivedKeys,
    projectResult.id,
    environmentName
  );
  if (envResult instanceof Response) return envResult;

  // Full override: delete all existing secrets first
  await deleteAllSecrets(db, envResult.id);

  const now = new Date().toISOString();
  let count = 0;

  for (const [key, value] of Object.entries(body.secrets)) {
    const keyEncrypted = await encrypt(derivedKeys.encryptionKey, key);
    const keyHash = await hmacSha256(derivedKeys.hmacKey, key);
    const valueEncrypted = await encrypt(derivedKeys.encryptionKey, String(value));

    let descriptionEncrypted: string | null = null;
    if (body.descriptions && body.descriptions[key]) {
      descriptionEncrypted = await encrypt(derivedKeys.encryptionKey, body.descriptions[key]);
    }

    await upsertSecret(db, {
      id: crypto.randomUUID(),
      environmentId: envResult.id,
      keyEncrypted,
      keyHash,
      valueEncrypted,
      descriptionEncrypted,
      updatedAt: now,
    });
    count++;
  }

  return jsonOk<SetSecretsResponse>({
    count,
    project: projectName,
    environment: environmentName,
  });
}

export async function handlePatchSecrets(
  _request: Request,
  db: DrizzleD1Database,
  auth: AuthContext,
  derivedKeys: DerivedKeys,
  projectName: string,
  environmentName: string,
  body: PatchSecretsInput
): Promise<Response> {
  // Scope + write check
  if (auth.keyType === "system") {
    if (!hasScope(auth, projectName, environmentName)) {
      return jsonError(
        "FORBIDDEN",
        "Key does not have access to this scope",
        403
      );
    }
    if (!canWrite(auth)) {
      return jsonError("FORBIDDEN", "Key does not have write permission", 403);
    }
  }

  const projectResult = await resolveProject(db, derivedKeys, projectName);
  if (projectResult instanceof Response) return projectResult;

  const envResult = await resolveEnvironment(
    db,
    derivedKeys,
    projectResult.id,
    environmentName
  );
  if (envResult instanceof Response) return envResult;

  const now = new Date().toISOString();
  let setCount = 0;
  let deletedCount = 0;

  // Upsert secrets
  if (body.set) {
    for (const [key, value] of Object.entries(body.set)) {
      const keyEncrypted = await encrypt(derivedKeys.encryptionKey, key);
      const keyHash = await hmacSha256(derivedKeys.hmacKey, key);
      const valueEncrypted = await encrypt(
        derivedKeys.encryptionKey,
        String(value)
      );

      let descriptionEncrypted: string | null | undefined = undefined;
      if (body.descriptions && key in body.descriptions) {
        const desc = body.descriptions[key];
        descriptionEncrypted = desc ? await encrypt(derivedKeys.encryptionKey, desc) : null;
      }

      await upsertSecret(db, {
        id: crypto.randomUUID(),
        environmentId: envResult.id,
        keyEncrypted,
        keyHash,
        valueEncrypted,
        descriptionEncrypted,
        updatedAt: now,
      });
      setCount++;
    }
  }

  // Update standalone descriptions
  if (body.descriptions) {
    for (const [key, desc] of Object.entries(body.descriptions)) {
      if (body.set && key in body.set) continue;
      
      const keyHash = await hmacSha256(derivedKeys.hmacKey, key);
      const descriptionEncrypted = desc ? await encrypt(derivedKeys.encryptionKey, desc) : null;
      await updateSecretDescriptionByHash(db, envResult.id, keyHash, descriptionEncrypted);
    }
  }

  // Delete secrets
  if (body.delete) {
    for (const key of body.delete) {
      const keyHash = await hmacSha256(derivedKeys.hmacKey, key);
      const deleted = await deleteSecretByHash(db, envResult.id, keyHash);
      if (deleted) deletedCount++;
    }
  }

  const total = await countSecrets(db, envResult.id);

  return jsonOk<PatchSecretsResponse>({
    set: setCount,
    deleted: deletedCount,
    total,
  });
}
