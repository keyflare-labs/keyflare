import { eq, and, sql, inArray } from "drizzle-orm";
import { DrizzleD1Database } from "drizzle-orm/d1";
import { apiKeys, projects, environments, secrets } from "./schema.js";

// Re-export schema for convenience
export { apiKeys, projects, environments, secrets };

// ─── Type aliases from Drizzle schema inference ───

export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type EnvironmentRow = typeof environments.$inferSelect;
export type SecretRow = typeof secrets.$inferSelect;

// ─── API Keys ───

export async function prefixExists(
  db: DrizzleD1Database,
  prefix: string
): Promise<boolean> {
  const rows = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(eq(apiKeys.keyPrefix, prefix))
    .limit(1);
  return rows.length > 0;
}

export async function getKeyByHash(
  db: DrizzleD1Database,
  keyHash: string
): Promise<ApiKeyRow | undefined> {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.revoked, 0)))
    .limit(1);
  return rows[0];
}

export async function countKeys(db: DrizzleD1Database): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(apiKeys);
  return rows[0]?.count ?? 0;
}

export async function insertKey(
  db: DrizzleD1Database,
  params: typeof apiKeys.$inferInsert
): Promise<void> {
  await db.insert(apiKeys).values(params);
}

export async function listKeys(db: DrizzleD1Database): Promise<ApiKeyRow[]> {
  return db.select().from(apiKeys).orderBy(apiKeys.createdAt);
}

export async function revokeKeyByPrefix(
  db: DrizzleD1Database,
  prefix: string
): Promise<boolean> {
  const result = await db
    .update(apiKeys)
    .set({ revoked: 1 })
    .where(and(eq(apiKeys.keyPrefix, prefix), eq(apiKeys.revoked, 0)));
  return (result.meta?.changes ?? 0) > 0;
}

export async function getKeyByPrefix(
  db: DrizzleD1Database,
  prefix: string
): Promise<ApiKeyRow | undefined> {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyPrefix, prefix))
    .limit(1);
  return rows[0];
}

export async function updateKeyScopes(
  db: DrizzleD1Database,
  prefix: string,
  encryptedScopes: string,
  permissions: "read" | "readwrite" | "full"
): Promise<boolean> {
  const result = await db
    .update(apiKeys)
    .set({ scopes: encryptedScopes, permissions })
    .where(and(eq(apiKeys.keyPrefix, prefix), eq(apiKeys.revoked, 0)));
  return (result.meta?.changes ?? 0) > 0;
}

export async function updateKeyLastUsed(
  db: DrizzleD1Database,
  keyId: string
): Promise<void> {
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(apiKeys.id, keyId));
}

// ─── Projects ───

export async function getProjectByName(
  db: DrizzleD1Database,
  name: string
): Promise<ProjectRow | undefined> {
  const normalizedName = name.toLowerCase();
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.name, normalizedName))
    .limit(1);
  return rows[0];
}

export async function listProjects(
  db: DrizzleD1Database
): Promise<ProjectRow[]> {
  return db.select().from(projects).orderBy(projects.createdAt);
}

export async function insertProject(
  db: DrizzleD1Database,
  params: typeof projects.$inferInsert
): Promise<void> {
  await db.insert(projects).values(params);
}

export async function deleteProject(
  db: DrizzleD1Database,
  projectId: string
): Promise<{ environments_removed: number; secrets_removed: number }> {
  // Find environments
  const envRows = await db
    .select({ id: environments.id })
    .from(environments)
    .where(eq(environments.projectId, projectId));
  const envIds = envRows.map((e) => e.id);

  let secretsRemoved = 0;
  if (envIds.length > 0) {
    // Count secrets
    const countRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(secrets)
      .where(inArray(secrets.environmentId, envIds));
    secretsRemoved = countRows[0]?.count ?? 0;

    // Delete secrets
    await db.delete(secrets).where(inArray(secrets.environmentId, envIds));
  }

  // Delete environments
  await db
    .delete(environments)
    .where(eq(environments.projectId, projectId));

  // Delete project
  await db.delete(projects).where(eq(projects.id, projectId));

  return {
    environments_removed: envIds.length,
    secrets_removed: secretsRemoved,
  };
}

// ─── Environments ───

export async function getEnvironmentByName(
  db: DrizzleD1Database,
  projectId: string,
  name: string
): Promise<EnvironmentRow | undefined> {
  const normalizedName = name.toLowerCase();
  const rows = await db
    .select()
    .from(environments)
    .where(
      and(
        eq(environments.projectId, projectId),
        eq(environments.name, normalizedName)
      )
    )
    .limit(1);
  return rows[0];
}

export async function listEnvironments(
  db: DrizzleD1Database,
  projectId: string
): Promise<EnvironmentRow[]> {
  return db
    .select()
    .from(environments)
    .where(eq(environments.projectId, projectId))
    .orderBy(environments.createdAt);
}

export async function insertEnvironment(
  db: DrizzleD1Database,
  params: typeof environments.$inferInsert
): Promise<void> {
  await db.insert(environments).values(params);
}

export async function deleteEnvironment(
  db: DrizzleD1Database,
  envId: string
): Promise<number> {
  // Count secrets
  const countRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(secrets)
    .where(eq(secrets.environmentId, envId));
  const secretsRemoved = countRows[0]?.count ?? 0;

  // Delete secrets then environment
  await db.delete(secrets).where(eq(secrets.environmentId, envId));
  await db.delete(environments).where(eq(environments.id, envId));

  return secretsRemoved;
}

// ─── Secrets ───

export async function getSecretsByEnvironment(
  db: DrizzleD1Database,
  environmentId: string
): Promise<SecretRow[]> {
  return db
    .select()
    .from(secrets)
    .where(eq(secrets.environmentId, environmentId));
}

export async function upsertSecret(
  db: DrizzleD1Database,
  params: typeof secrets.$inferInsert
): Promise<void> {
  await db
    .insert(secrets)
    .values(params)
    .onConflictDoUpdate({
      target: [secrets.environmentId, secrets.keyHash],
      set: {
        keyEncrypted: params.keyEncrypted,
        valueEncrypted: params.valueEncrypted,
        updatedAt: params.updatedAt,
      },
    });
}

export async function deleteSecretByHash(
  db: DrizzleD1Database,
  environmentId: string,
  keyHash: string
): Promise<boolean> {
  const result = await db
    .delete(secrets)
    .where(
      and(eq(secrets.environmentId, environmentId), eq(secrets.keyHash, keyHash))
    );
  return (result.meta?.changes ?? 0) > 0;
}

export async function deleteAllSecrets(
  db: DrizzleD1Database,
  environmentId: string
): Promise<number> {
  const countRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(secrets)
    .where(eq(secrets.environmentId, environmentId));
  const count = countRows[0]?.count ?? 0;

  await db.delete(secrets).where(eq(secrets.environmentId, environmentId));

  return count;
}

export async function countSecrets(
  db: DrizzleD1Database,
  environmentId: string
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(secrets)
    .where(eq(secrets.environmentId, environmentId));
  return rows[0]?.count ?? 0;
}

export async function countEnvironments(
  db: DrizzleD1Database,
  projectId: string
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(environments)
    .where(eq(environments.projectId, projectId));
  return rows[0]?.count ?? 0;
}
