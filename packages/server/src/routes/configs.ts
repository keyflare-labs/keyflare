import type {
  CreateConfigRequest,
  CreateConfigResponse,
  ListConfigsResponse,
} from "@keyflare/shared";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { encrypt, decrypt } from "../crypto/encrypt.js";
import { hmacSha256 } from "../crypto/hash.js";
import {
  getProjectByHash,
  getEnvironmentByHash,
  listEnvironments,
  insertEnvironment,
  deleteEnvironment,
  countSecrets,
} from "../db/queries.js";
import type { AuthContext, DerivedKeys } from "../types.js";
import { jsonOk, jsonError, parseJsonBody } from "../utils.js";
import { isUserKey, hasScope } from "../middleware/auth.js";

/** Resolve a project by name → { id, name } or return error Response. */
export async function resolveProject(
  db: DrizzleD1Database,
  derivedKeys: DerivedKeys,
  projectName: string
): Promise<{ id: string; name: string } | Response> {
  const nameHash = await hmacSha256(derivedKeys.hmacKey, projectName);
  const project = await getProjectByHash(db, nameHash);
  if (!project) {
    return jsonError("NOT_FOUND", `Project "${projectName}" not found`, 404);
  }
  return { id: project.id, name: projectName };
}

/** Resolve an environment by name within a project → { id, name } or error Response. */
export async function resolveEnvironment(
  db: DrizzleD1Database,
  derivedKeys: DerivedKeys,
  projectId: string,
  configName: string
): Promise<{ id: string; name: string } | Response> {
  const nameHash = await hmacSha256(derivedKeys.hmacKey, configName);
  const environment = await getEnvironmentByHash(db, projectId, nameHash);
  if (!environment) {
    return jsonError("NOT_FOUND", `Config "${configName}" not found`, 404);
  }
  return { id: environment.id, name: configName };
}

export async function handleCreateConfig(
  request: Request,
  db: DrizzleD1Database,
  auth: AuthContext,
  derivedKeys: DerivedKeys,
  projectName: string
): Promise<Response> {
  if (!isUserKey(auth)) {
    return jsonError(
      "FORBIDDEN",
      "Only user keys can create configs",
      403
    );
  }

  const body = await parseJsonBody<CreateConfigRequest>(request);
  if (!body || !body.name || typeof body.name !== "string" || !body.name.trim()) {
    return jsonError("BAD_REQUEST", "Missing or empty field: name", 400);
  }

  const projectResult = await resolveProject(db, derivedKeys, projectName);
  if (projectResult instanceof Response) return projectResult;

  const name = body.name.trim();
  const nameHash = await hmacSha256(derivedKeys.hmacKey, name);
  const nameEncrypted = await encrypt(derivedKeys.encryptionKey, name);

  // Check for duplicate
  const existing = await getEnvironmentByHash(
    db,
    projectResult.id,
    nameHash
  );
  if (existing) {
    return jsonError(
      "CONFLICT",
      `Config "${name}" already exists in project "${projectName}"`,
      409
    );
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await insertEnvironment(db, {
    id,
    projectId: projectResult.id,
    nameEncrypted,
    nameHash,
    createdAt: now,
  });

  return jsonOk<CreateConfigResponse>(
    {
      id,
      name,
      project: projectName,
      created_at: now,
    },
    201
  );
}

export async function handleListConfigs(
  request: Request,
  db: DrizzleD1Database,
  auth: AuthContext,
  derivedKeys: DerivedKeys,
  projectName: string
): Promise<Response> {
  const projectResult = await resolveProject(db, derivedKeys, projectName);
  if (projectResult instanceof Response) return projectResult;

  const rows = await listEnvironments(db, projectResult.id);
  const configs = [];

  for (const row of rows) {
    let name: string;
    try {
      name = await decrypt(derivedKeys.encryptionKey, row.nameEncrypted);
    } catch {
      name = "(decryption failed)";
    }

    // If system key, filter by scope
    if (auth.keyType === "system") {
      if (!hasScope(auth, projectName, name)) continue;
    }

    const secretCount = await countSecrets(db, row.id);
    configs.push({
      id: row.id,
      name,
      secret_count: secretCount,
      created_at: row.createdAt,
    });
  }

  return jsonOk<ListConfigsResponse>({ configs });
}

export async function handleDeleteConfig(
  request: Request,
  db: DrizzleD1Database,
  auth: AuthContext,
  derivedKeys: DerivedKeys,
  projectName: string,
  configName: string
): Promise<Response> {
  if (!isUserKey(auth)) {
    return jsonError(
      "FORBIDDEN",
      "Only user keys can delete configs",
      403
    );
  }

  const projectResult = await resolveProject(db, derivedKeys, projectName);
  if (projectResult instanceof Response) return projectResult;

  const envResult = await resolveEnvironment(
    db,
    derivedKeys,
    projectResult.id,
    configName
  );
  if (envResult instanceof Response) return envResult;

  const secretsRemoved = await deleteEnvironment(db, envResult.id);

  return jsonOk({
    deleted: configName,
    project: projectName,
    secrets_removed: secretsRemoved,
  });
}
