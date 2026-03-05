import type {
  CreateProjectRequest,
  CreateProjectResponse,
  ListProjectsResponse,
  DeleteProjectResponse,
} from "@keyflare/shared";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { encrypt, decrypt } from "../crypto/encrypt.js";
import { hmacSha256 } from "../crypto/hash.js";
import {
  getProjectByHash,
  listProjects,
  insertProject,
  deleteProject,
  countEnvironments,
} from "../db/queries.js";
import type { AuthContext, DerivedKeys } from "../types.js";
import { jsonOk, jsonError, parseJsonBody } from "../utils.js";
import { isUserKey } from "../middleware/auth.js";

export async function handleCreateProject(
  request: Request,
  db: DrizzleD1Database,
  auth: AuthContext,
  derivedKeys: DerivedKeys
): Promise<Response> {
  if (!isUserKey(auth)) {
    return jsonError("FORBIDDEN", "Only user keys can create projects", 403);
  }

  const body = await parseJsonBody<CreateProjectRequest>(request);
  if (!body || !body.name || typeof body.name !== "string" || !body.name.trim()) {
    return jsonError("BAD_REQUEST", "Missing or empty field: name", 400);
  }

  const name = body.name.trim();
  const nameHash = await hmacSha256(derivedKeys.hmacKey, name);
  const nameEncrypted = await encrypt(derivedKeys.encryptionKey, name);

  // Check for duplicate
  const existing = await getProjectByHash(db, nameHash);
  if (existing) {
    return jsonError("CONFLICT", `Project "${name}" already exists`, 409);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await insertProject(db, {
    id,
    nameEncrypted,
    nameHash,
    createdAt: now,
  });

  return jsonOk<CreateProjectResponse>({ id, name, created_at: now }, 201);
}

export async function handleListProjects(
  request: Request,
  db: DrizzleD1Database,
  auth: AuthContext,
  derivedKeys: DerivedKeys
): Promise<Response> {
  const rows = await listProjects(db);
  const projects = [];

  for (const row of rows) {
    let name: string;
    try {
      name = await decrypt(derivedKeys.encryptionKey, row.nameEncrypted);
    } catch {
      name = "(decryption failed)";
    }

    // If system key, filter to scoped projects only
    if (auth.keyType === "system" && auth.scopes) {
      if (!auth.scopes.some((s) => s.project === name)) continue;
    }

    const envCount = await countEnvironments(db, row.id);
    projects.push({
      id: row.id,
      name,
      environment_count: envCount,
      created_at: row.createdAt,
    });
  }

  return jsonOk<ListProjectsResponse>({ projects });
}

export async function handleDeleteProject(
  request: Request,
  db: DrizzleD1Database,
  auth: AuthContext,
  derivedKeys: DerivedKeys,
  projectName: string
): Promise<Response> {
  if (!isUserKey(auth)) {
    return jsonError("FORBIDDEN", "Only user keys can delete projects", 403);
  }

  const nameHash = await hmacSha256(derivedKeys.hmacKey, projectName);
  const project = await getProjectByHash(db, nameHash);
  if (!project) {
    return jsonError("NOT_FOUND", `Project "${projectName}" not found`, 404);
  }

  const { environments_removed, secrets_removed } = await deleteProject(
    db,
    project.id
  );

  return jsonOk<DeleteProjectResponse>({
    deleted: projectName,
    environments_removed,
    secrets_removed,
  });
}
