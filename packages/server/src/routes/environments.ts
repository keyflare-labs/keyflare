import type {
  CreateEnvironmentResponse,
  ListEnvironmentsResponse,
} from "@keyflare/shared";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
  getProjectByName,
  getEnvironmentByName,
  listEnvironments,
  insertEnvironment,
  deleteEnvironment,
  countSecrets,
} from "../db/queries.js";
import type { AuthContext, DerivedKeys } from "../types.js";
import { jsonOk, jsonError } from "../utils.js";
import { isUserKey, hasScope } from "../middleware/auth.js";
import type { CreateEnvironmentInput } from "../validation/schemas.js";

export async function resolveProject(
  db: DrizzleD1Database,
  _derivedKeys: DerivedKeys,
  projectName: string
): Promise<{ id: string; name: string } | Response> {
  const project = await getProjectByName(db, projectName);
  if (!project) {
    return jsonError("NOT_FOUND", `Project "${projectName}" not found`, 404);
  }
  return { id: project.id, name: projectName };
}

export async function resolveEnvironment(
  db: DrizzleD1Database,
  _derivedKeys: DerivedKeys,
  projectId: string,
  environmentName: string
): Promise<{ id: string; name: string } | Response> {
  const environment = await getEnvironmentByName(db, projectId, environmentName);
  if (!environment) {
    return jsonError("NOT_FOUND", `Environment "${environmentName}" not found`, 404);
  }
  return { id: environment.id, name: environmentName };
}

export async function handleCreateEnvironment(
  _request: Request,
  db: DrizzleD1Database,
  auth: AuthContext,
  derivedKeys: DerivedKeys,
  projectName: string,
  body: CreateEnvironmentInput
): Promise<Response> {
  if (!isUserKey(auth)) {
    return jsonError(
      "FORBIDDEN",
      "Only user keys can create environments",
      403
    );
  }

  const projectResult = await resolveProject(db, derivedKeys, projectName);
  if (projectResult instanceof Response) return projectResult;

  const name = body.name.trim().toLowerCase();

  const existing = await getEnvironmentByName(
    db,
    projectResult.id,
    name
  );
  if (existing) {
    return jsonError(
      "CONFLICT",
      `Environment "${name}" already exists in project "${projectName}"`,
      409
    );
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await insertEnvironment(db, {
    id,
    projectId: projectResult.id,
    name,
    createdAt: now,
  });

  return jsonOk<CreateEnvironmentResponse>(
    {
      id,
      name,
      project: projectName,
      created_at: now,
    },
    201
  );
}

export async function handleListEnvironments(
  request: Request,
  db: DrizzleD1Database,
  auth: AuthContext,
  derivedKeys: DerivedKeys,
  projectName: string
): Promise<Response> {
  const projectResult = await resolveProject(db, derivedKeys, projectName);
  if (projectResult instanceof Response) return projectResult;

  const rows = await listEnvironments(db, projectResult.id);
  const environments = [];

  for (const row of rows) {
    const name = row.name;

    if (auth.keyType === "system") {
      if (!hasScope(auth, projectName, name)) continue;
    }

    const secretCount = await countSecrets(db, row.id);
    environments.push({
      id: row.id,
      name,
      secret_count: secretCount,
      created_at: row.createdAt,
    });
  }

  return jsonOk<ListEnvironmentsResponse>({ environments });
}

export async function handleDeleteEnvironment(
  request: Request,
  db: DrizzleD1Database,
  auth: AuthContext,
  derivedKeys: DerivedKeys,
  projectName: string,
  environmentName: string
): Promise<Response> {
  if (!isUserKey(auth)) {
    return jsonError(
      "FORBIDDEN",
      "Only user keys can delete environments",
      403
    );
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

  const secretsRemoved = await deleteEnvironment(db, envResult.id);

  return jsonOk({
    deleted: environmentName,
    project: projectName,
    secrets_removed: secretsRemoved,
  });
}
