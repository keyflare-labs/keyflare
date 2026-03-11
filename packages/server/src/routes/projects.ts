import type {
  CreateProjectResponse,
  ListProjectsResponse,
  DeleteProjectResponse,
} from "@keyflare/shared";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
  getProjectByName,
  listProjects,
  insertProject,
  insertEnvironment,
  deleteProject,
  countEnvironments,
} from "../db/queries.js";
import type { AuthContext, DerivedKeys } from "../types.js";
import { jsonOk, jsonError } from "../utils.js";
import { isUserKey } from "../middleware/auth.js";
import type { CreateProjectInput } from "../validation/schemas.js";

export async function handleCreateProject(
  _request: Request,
  db: DrizzleD1Database,
  auth: AuthContext,
  _derivedKeys: DerivedKeys,
  body: CreateProjectInput
): Promise<Response> {
  if (!isUserKey(auth)) {
    return jsonError("FORBIDDEN", "Only user keys can create projects", 403);
  }

  const name = body.name.trim().toLowerCase();
  const environmentless = body.environmentless === true;

  // Check for duplicate
  const existing = await getProjectByName(db, name);
  if (existing) {
    return jsonError("CONFLICT", `Project "${name}" already exists`, 409);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await insertProject(db, {
    id,
    name,
    createdAt: now,
  });

  if (!environmentless) {
    const defaultEnvNames = ["dev", "prod"];
    for (const envName of defaultEnvNames) {
      await insertEnvironment(db, {
        id: crypto.randomUUID(),
        projectId: id,
        name: envName,
        createdAt: now,
      });
    }
  }

  return jsonOk<CreateProjectResponse>({ id, name, created_at: now }, 201);
}

export async function handleListProjects(
  request: Request,
  db: DrizzleD1Database,
  auth: AuthContext,
  _derivedKeys: DerivedKeys
): Promise<Response> {
  const rows = await listProjects(db);
  const projects = [];

  for (const row of rows) {
    const name = row.name;

    // If system key, filter to scoped projects only
    if (auth.keyType === "system" && auth.scopes) {
      if (!auth.scopes.some((s) => s.project.toLowerCase() === name)) continue;
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
  _derivedKeys: DerivedKeys,
  projectName: string
): Promise<Response> {
  if (!isUserKey(auth)) {
    return jsonError("FORBIDDEN", "Only user keys can delete projects", 403);
  }

  const project = await getProjectByName(db, projectName);
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
