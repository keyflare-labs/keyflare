import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

// ─── API Keys ───

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  type: text("type", { enum: ["user", "system"] }).notNull(),
  label: text("label"),
  scopes: text("scopes"),
  permissions: text("permissions", { enum: ["read", "readwrite", "full"] }).notNull(),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
  revoked: integer("revoked", { mode: "number" }).default(0).notNull(),
});

// ─── Projects ───

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: text("created_at").notNull(),
});

// ─── Environments ───

export const environments = sqliteTable(
  "environments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("environments_project_id_name_unique").on(
      table.projectId,
      table.name
    ),
  ]
);

// ─── Secrets ───

export const secrets = sqliteTable(
  "secrets",
  {
    id: text("id").primaryKey(),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    keyEncrypted: text("key_encrypted").notNull(),
    keyHash: text("key_hash").notNull(),
    valueEncrypted: text("value_encrypted").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("secrets_environment_id_key_hash_unique").on(
      table.environmentId,
      table.keyHash
    ),
  ]
);
