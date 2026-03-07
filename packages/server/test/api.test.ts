import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
} from "vitest";
import {
  env,
  SELF,
  applyD1Migrations,
} from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { apiKeys, projects, environments, secrets } from "../src/db/schema";

// ─── Helpers ───

async function post(path: string, body?: unknown, apiKey?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return SELF.fetch(`http://localhost${path}`, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function get(path: string, apiKey?: string) {
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return SELF.fetch(`http://localhost${path}`, {
    method: "GET",
    headers,
  });
}

async function put(path: string, body: unknown, apiKey: string) {
  return SELF.fetch(`http://localhost${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

async function patch(path: string, body: unknown, apiKey: string) {
  return SELF.fetch(`http://localhost${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

async function del(path: string, apiKey: string) {
  return SELF.fetch(`http://localhost${path}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
}

/** Clean all tables between tests using Drizzle. */
async function cleanDb() {
  const db = drizzle(env.DB);
  await db.delete(secrets);
  await db.delete(environments);
  await db.delete(projects);
  await db.delete(apiKeys);
}

// ─── Tests ───

describe("Keyflare API", () => {
  beforeAll(async () => {
    // Apply Drizzle-generated migrations via Cloudflare's test helper
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  beforeEach(async () => {
    await cleanDb();
  });

  // ─── Health ───
  describe("GET /health", () => {
    it("returns health status", async () => {
      const res = await get("/health");
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.ok).toBe(true);
      expect(json.data.version).toBe("0.1.0");
    });
  });

  // ─── Bootstrap ───
  describe("POST /bootstrap", () => {
    it("creates first user key when no keys exist", async () => {
      const res = await post("/bootstrap");
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.ok).toBe(true);
      expect(json.data.key).toMatch(/^kfl_user_/);
      expect(json.data.prefix).toHaveLength(12);
      expect(json.data.type).toBe("user");
      expect(json.data.label).toBe("bootstrap");
    });

    it("returns 409 on second bootstrap", async () => {
      await post("/bootstrap");
      const res = await post("/bootstrap");
      expect(res.status).toBe(409);
      const json = (await res.json()) as any;
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("CONFLICT");
    });
  });

  // ─── Auth ───
  describe("Authentication", () => {
    it("returns 401 without API key", async () => {
      const res = await get("/projects");
      expect(res.status).toBe(401);
    });

    it("returns 401 with invalid API key", async () => {
      const res = await get("/projects", "kfl_user_invalidkey1234567890abcdef");
      expect(res.status).toBe(401);
    });
  });

  // ─── Projects ───
  describe("Projects", () => {
    let userKey: string;

    beforeEach(async () => {
      const res = await post("/bootstrap");
      const json = (await res.json()) as any;
      userKey = json.data.key;
    });

    it("creates a project", async () => {
      const res = await post("/projects", { name: "my-api" }, userKey);
      expect(res.status).toBe(201);
      const json = (await res.json()) as any;
      expect(json.ok).toBe(true);
      expect(json.data.name).toBe("my-api");
      expect(json.data.id).toBeTruthy();
    });

    it("rejects duplicate project", async () => {
      await post("/projects", { name: "my-api" }, userKey);
      const res = await post("/projects", { name: "my-api" }, userKey);
      expect(res.status).toBe(409);
    });

    it("lists projects", async () => {
      await post("/projects", { name: "project-a" }, userKey);
      await post("/projects", { name: "project-b" }, userKey);

      const res = await get("/projects", userKey);
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.data.projects).toHaveLength(2);
      const names = json.data.projects.map((p: any) => p.name).sort();
      expect(names).toEqual(["project-a", "project-b"]);
    });

    it("deletes a project", async () => {
      await post("/projects", { name: "to-delete" }, userKey);
      const res = await del("/projects/to-delete", userKey);
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.data.deleted).toBe("to-delete");

      // Confirm it's gone
      const listRes = await get("/projects", userKey);
      const listJson = (await listRes.json()) as any;
      expect(listJson.data.projects).toHaveLength(0);
    });

    it("creates a project with default Dev and Prod environments", async () => {
      const res = await post(
        "/projects",
        { name: "with-defaults" },
        userKey
      );
      expect(res.status).toBe(201);
      const listRes = await get(
        "/projects/with-defaults/configs",
        userKey
      );
      expect(listRes.status).toBe(200);
      const listJson = (await listRes.json()) as any;
      expect(listJson.data.configs).toHaveLength(2);
      const names = listJson.data.configs.map((c: any) => c.name).sort();
      expect(names).toEqual(["Dev", "Prod"]);
    });

    it("creates a project with environmentless: true without default environments", async () => {
      const res = await post(
        "/projects",
        { name: "no-defaults", environmentless: true },
        userKey
      );
      expect(res.status).toBe(201);
      const listRes = await get("/projects/no-defaults/configs", userKey);
      expect(listRes.status).toBe(200);
      const listJson = (await listRes.json()) as any;
      expect(listJson.data.configs).toHaveLength(0);
    });

    it("list projects shows correct environment_count for default vs environmentless", async () => {
      await post("/projects", { name: "with-defaults" }, userKey);
      await post(
        "/projects",
        { name: "without-defaults", environmentless: true },
        userKey
      );
      const res = await get("/projects", userKey);
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.data.projects).toHaveLength(2);
      const withDefaults = json.data.projects.find(
        (p: any) => p.name === "with-defaults"
      );
      const withoutDefaults = json.data.projects.find(
        (p: any) => p.name === "without-defaults"
      );
      expect(withDefaults.environment_count).toBe(2);
      expect(withoutDefaults.environment_count).toBe(0);
    });

    it("environmentless: false explicitly creates default environments", async () => {
      const res = await post(
        "/projects",
        { name: "explicit-not-envless", environmentless: false },
        userKey
      );
      expect(res.status).toBe(201);
      const listRes = await get(
        "/projects/explicit-not-envless/configs",
        userKey
      );
      expect(listRes.status).toBe(200);
      const listJson = (await listRes.json()) as any;
      expect(listJson.data.configs).toHaveLength(2);
      const names = listJson.data.configs.map((c: any) => c.name).sort();
      expect(names).toEqual(["Dev", "Prod"]);
    });

    it("returns 404 when deleting non-existent project", async () => {
      const res = await del("/projects/nope", userKey);
      expect(res.status).toBe(404);
    });
  });

  // ─── Configs ───
  describe("Configs (Environments)", () => {
    let userKey: string;

    beforeEach(async () => {
      const bootstrapRes = await post("/bootstrap");
      const bootstrapJson = (await bootstrapRes.json()) as any;
      userKey = bootstrapJson.data.key;
      await post("/projects", { name: "my-api", environmentless: true }, userKey);
    });

    it("creates a config", async () => {
      const res = await post(
        "/projects/my-api/configs",
        { name: "production" },
        userKey
      );
      expect(res.status).toBe(201);
      const json = (await res.json()) as any;
      expect(json.data.name).toBe("production");
      expect(json.data.project).toBe("my-api");
    });

    it("rejects duplicate config", async () => {
      await post(
        "/projects/my-api/configs",
        { name: "production" },
        userKey
      );
      const res = await post(
        "/projects/my-api/configs",
        { name: "production" },
        userKey
      );
      expect(res.status).toBe(409);
    });

    it("lists configs", async () => {
      await post(
        "/projects/my-api/configs",
        { name: "development" },
        userKey
      );
      await post(
        "/projects/my-api/configs",
        { name: "staging" },
        userKey
      );

      const res = await get("/projects/my-api/configs", userKey);
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.data.configs).toHaveLength(2);
    });

    it("deletes a config", async () => {
      await post(
        "/projects/my-api/configs",
        { name: "temp" },
        userKey
      );
      const res = await del("/projects/my-api/configs/temp", userKey);
      expect(res.status).toBe(200);

      const listRes = await get("/projects/my-api/configs", userKey);
      const listJson = (await listRes.json()) as any;
      expect(listJson.data.configs).toHaveLength(0);
    });
  });

  // ─── Secrets ───
  describe("Secrets", () => {
    let userKey: string;

    beforeEach(async () => {
      const bootstrapRes = await post("/bootstrap");
      const bootstrapJson = (await bootstrapRes.json()) as any;
      userKey = bootstrapJson.data.key;
      await post("/projects", { name: "my-api", environmentless: true }, userKey);
      await post(
        "/projects/my-api/configs",
        { name: "production" },
        userKey
      );
    });

    it("sets and gets secrets (PUT = full override)", async () => {
      const setRes = await put(
        "/projects/my-api/configs/production/secrets",
        {
          secrets: {
            DATABASE_URL: "postgres://localhost:5432/db",
            API_KEY: "sk_live_abc123",
          },
        },
        userKey
      );
      expect(setRes.status).toBe(200);
      const setJson = (await setRes.json()) as any;
      expect(setJson.data.count).toBe(2);

      // Get secrets
      const getRes = await get(
        "/projects/my-api/configs/production/secrets",
        userKey
      );
      expect(getRes.status).toBe(200);
      const getJson = (await getRes.json()) as any;
      expect(getJson.data.secrets).toEqual({
        DATABASE_URL: "postgres://localhost:5432/db",
        API_KEY: "sk_live_abc123",
      });
    });

    it("PUT replaces all existing secrets", async () => {
      // Set initial secrets
      await put(
        "/projects/my-api/configs/production/secrets",
        {
          secrets: { OLD_KEY: "old-value", KEEP: "this" },
        },
        userKey
      );

      // Full override
      await put(
        "/projects/my-api/configs/production/secrets",
        {
          secrets: { NEW_KEY: "new-value" },
        },
        userKey
      );

      const getRes = await get(
        "/projects/my-api/configs/production/secrets",
        userKey
      );
      const getJson = (await getRes.json()) as any;
      expect(getJson.data.secrets).toEqual({
        NEW_KEY: "new-value",
      });
      // OLD_KEY and KEEP should be gone
      expect(getJson.data.secrets.OLD_KEY).toBeUndefined();
    });

    it("PATCH upserts and deletes specific secrets", async () => {
      // Set initial
      await put(
        "/projects/my-api/configs/production/secrets",
        {
          secrets: { A: "1", B: "2", C: "3" },
        },
        userKey
      );

      // Patch: update A, add D, delete B
      const patchRes = await patch(
        "/projects/my-api/configs/production/secrets",
        {
          set: { A: "updated", D: "4" },
          delete: ["B"],
        },
        userKey
      );
      expect(patchRes.status).toBe(200);
      const patchJson = (await patchRes.json()) as any;
      expect(patchJson.data.set).toBe(2);
      expect(patchJson.data.deleted).toBe(1);
      expect(patchJson.data.total).toBe(3); // A, C, D

      // Verify
      const getRes = await get(
        "/projects/my-api/configs/production/secrets",
        userKey
      );
      const getJson = (await getRes.json()) as any;
      expect(getJson.data.secrets).toEqual({
        A: "updated",
        C: "3",
        D: "4",
      });
    });

    it("returns empty secrets for new config", async () => {
      const res = await get(
        "/projects/my-api/configs/production/secrets",
        userKey
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.data.secrets).toEqual({});
    });

    it("returns 404 for secrets in non-existent project", async () => {
      const res = await get(
        "/projects/nope/configs/production/secrets",
        userKey
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 for secrets in non-existent config", async () => {
      const res = await get(
        "/projects/my-api/configs/nope/secrets",
        userKey
      );
      expect(res.status).toBe(404);
    });
  });

  // ─── API Keys CRUD ───
  describe("API Keys", () => {
    let userKey: string;

    beforeEach(async () => {
      const res = await post("/bootstrap");
      const json = (await res.json()) as any;
      userKey = json.data.key;
    });

    it("creates a system key with scopes", async () => {
      const res = await post(
        "/keys",
        {
          type: "system",
          label: "ci-prod",
          scopes: [
            { project: "my-api", environment: "production" },
          ],
          permission: "read",
        },
        userKey
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.data.key).toMatch(/^kfl_sys_/);
      expect(json.data.type).toBe("system");
      expect(json.data.permission).toBe("read");
    });

    it("creates a user key", async () => {
      const res = await post(
        "/keys",
        { type: "user", label: "backup-admin" },
        userKey
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.data.key).toMatch(/^kfl_user_/);
    });

    it("lists keys", async () => {
      await post(
        "/keys",
        { type: "user", label: "second-key" },
        userKey
      );
      const res = await get("/keys", userKey);
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.data.keys.length).toBeGreaterThanOrEqual(2); // bootstrap + second
    });

    it("revokes a key", async () => {
      const createRes = await post(
        "/keys",
        {
          type: "system",
          label: "to-revoke",
          scopes: [{ project: "x", environment: "*" }],
          permission: "read",
        },
        userKey
      );
      const createJson = (await createRes.json()) as any;
      const prefix = createJson.data.prefix;
      const sysKey = createJson.data.key;

      // Key should work before revoke
      const healthRes = await get("/projects", sysKey);
      expect(healthRes.status).toBe(200);

      // Revoke
      const revokeRes = await del(`/keys/${prefix}`, userKey);
      expect(revokeRes.status).toBe(200);

      // Key should no longer work
      const afterRes = await get("/projects", sysKey);
      expect(afterRes.status).toBe(401);
    });

    it("system key with read cannot write secrets", async () => {
      // Setup project + config
      await post("/projects", { name: "my-api" }, userKey);
      await post(
        "/projects/my-api/configs",
        { name: "production" },
        userKey
      );

      // Create read-only system key
      const keyRes = await post(
        "/keys",
        {
          type: "system",
          label: "reader",
          scopes: [{ project: "my-api", environment: "production" }],
          permission: "read",
        },
        userKey
      );
      const sysKey = ((await keyRes.json()) as any).data.key;

      // Reading should work
      const readRes = await get(
        "/projects/my-api/configs/production/secrets",
        sysKey
      );
      expect(readRes.status).toBe(200);

      // Writing should be forbidden
      const writeRes = await put(
        "/projects/my-api/configs/production/secrets",
        { secrets: { FOO: "bar" } },
        sysKey
      );
      expect(writeRes.status).toBe(403);
    });

    it("system key cannot access out-of-scope project", async () => {
      await post("/projects", { name: "my-api" }, userKey);
      await post(
        "/projects/my-api/configs",
        { name: "production" },
        userKey
      );
      await post("/projects", { name: "other" }, userKey);
      await post(
        "/projects/other/configs",
        { name: "production" },
        userKey
      );

      // Create key scoped only to my-api:production
      const keyRes = await post(
        "/keys",
        {
          type: "system",
          label: "scoped",
          scopes: [{ project: "my-api", environment: "production" }],
          permission: "readwrite",
        },
        userKey
      );
      const sysKey = ((await keyRes.json()) as any).data.key;

      // In-scope should work
      const okRes = await get(
        "/projects/my-api/configs/production/secrets",
        sysKey
      );
      expect(okRes.status).toBe(200);

      // Out-of-scope should be forbidden
      const nopeRes = await get(
        "/projects/other/configs/production/secrets",
        sysKey
      );
      expect(nopeRes.status).toBe(403);
    });

    it("system key with wildcard env can access any env in project", async () => {
      await post("/projects", { name: "my-api" }, userKey);
      await post(
        "/projects/my-api/configs",
        { name: "production" },
        userKey
      );
      await post(
        "/projects/my-api/configs",
        { name: "staging" },
        userKey
      );

      const keyRes = await post(
        "/keys",
        {
          type: "system",
          label: "wildcard",
          scopes: [{ project: "my-api", environment: "*" }],
          permission: "read",
        },
        userKey
      );
      const sysKey = ((await keyRes.json()) as any).data.key;

      const prodRes = await get(
        "/projects/my-api/configs/production/secrets",
        sysKey
      );
      expect(prodRes.status).toBe(200);

      const stagingRes = await get(
        "/projects/my-api/configs/staging/secrets",
        sysKey
      );
      expect(stagingRes.status).toBe(200);
    });

    it("system key cannot create projects", async () => {
      const keyRes = await post(
        "/keys",
        {
          type: "system",
          label: "no-projects",
          scopes: [{ project: "x", environment: "*" }],
          permission: "readwrite",
        },
        userKey
      );
      const sysKey = ((await keyRes.json()) as any).data.key;

      const res = await post(
        "/projects",
        { name: "evil-project" },
        sysKey
      );
      expect(res.status).toBe(403);
    });

    it("system key cannot manage other keys", async () => {
      const keyRes = await post(
        "/keys",
        {
          type: "system",
          label: "no-keys",
          scopes: [{ project: "x", environment: "*" }],
          permission: "readwrite",
        },
        userKey
      );
      const sysKey = ((await keyRes.json()) as any).data.key;

      const res = await get("/keys", sysKey);
      expect(res.status).toBe(403);
    });

    // ─── Update Key (PUT /keys/:prefix) ───
    describe("PUT /keys/:prefix", () => {
      it("updates scopes and permission for a system key", async () => {
        // Create a system key
        const createRes = await post(
          "/keys",
          {
            type: "system",
            label: "ci-key",
            scopes: [{ project: "my-api", environment: "production" }],
            permission: "read",
          },
          userKey
        );
        const createJson = (await createRes.json()) as any;
        const prefix = createJson.data.prefix;
        const _sysKey = createJson.data.key;

        // Update the key
        const updateRes = await put(
          `/keys/${prefix}`,
          {
            scopes: [
              { project: "my-api", environment: "production" },
              { project: "my-api", environment: "staging" },
            ],
            permission: "readwrite",
          },
          userKey
        );
        expect(updateRes.status).toBe(200);
        const updateJson = (await updateRes.json()) as any;
        expect(updateJson.ok).toBe(true);
        expect(updateJson.data.prefix).toBe(prefix);
        expect(updateJson.data.type).toBe("system");
        expect(updateJson.data.label).toBe("ci-key");
        expect(updateJson.data.permission).toBe("readwrite");
        expect(updateJson.data.scopes).toHaveLength(2);
        expect(updateJson.data.scopes[0]).toEqual({
          project: "my-api",
          environment: "production",
        });
        expect(updateJson.data.scopes[1]).toEqual({
          project: "my-api",
          environment: "staging",
        });
      });

      it("replaces all existing scopes (not merge)", async () => {
        // Create with two scopes
        const createRes = await post(
          "/keys",
          {
            type: "system",
            label: "replace-test",
            scopes: [
              { project: "project-a", environment: "production" },
              { project: "project-b", environment: "staging" },
            ],
            permission: "read",
          },
          userKey
        );
        const prefix = ((await createRes.json()) as any).data.prefix;

        // Update with completely different scopes
        const updateRes = await put(
          `/keys/${prefix}`,
          {
            scopes: [{ project: "project-c", environment: "*" }],
            permission: "read",
          },
          userKey
        );
        expect(updateRes.status).toBe(200);
        const updateJson = (await updateRes.json()) as any;
        expect(updateJson.data.scopes).toHaveLength(1);
        expect(updateJson.data.scopes[0]).toEqual({
          project: "project-c",
          environment: "*",
        });
      });

      it("returns 400 when trying to update a user key", async () => {
        // Create a second user key
        const createRes = await post(
          "/keys",
          { type: "user", label: "second-user" },
          userKey
        );
        const prefix = ((await createRes.json()) as any).data.prefix;

        // Try to update it
        const updateRes = await put(
          `/keys/${prefix}`,
          {
            scopes: [{ project: "x", environment: "*" }],
            permission: "read",
          },
          userKey
        );
        expect(updateRes.status).toBe(400);
        const json = (await updateRes.json()) as any;
        expect(json.ok).toBe(false);
        expect(json.error.code).toBe("BAD_REQUEST");
        expect(json.error.message).toContain("User keys cannot have their scopes updated");
      });

      it("returns 400 when trying to update a revoked key", async () => {
        // Create and revoke a system key
        const createRes = await post(
          "/keys",
          {
            type: "system",
            label: "to-revoke",
            scopes: [{ project: "x", environment: "*" }],
            permission: "read",
          },
          userKey
        );
        const prefix = ((await createRes.json()) as any).data.prefix;
        await del(`/keys/${prefix}`, userKey);

        // Try to update the revoked key
        const updateRes = await put(
          `/keys/${prefix}`,
          {
            scopes: [{ project: "y", environment: "*" }],
            permission: "readwrite",
          },
          userKey
        );
        expect(updateRes.status).toBe(400);
        const json = (await updateRes.json()) as any;
        expect(json.ok).toBe(false);
        expect(json.error.message).toContain("revoked");
      });

      it("returns 404 for non-existent key prefix", async () => {
        const updateRes = await put(
          "/keys/kfl_sys_nope",
          {
            scopes: [{ project: "x", environment: "*" }],
            permission: "read",
          },
          userKey
        );
        expect(updateRes.status).toBe(404);
        const json = (await updateRes.json()) as any;
        expect(json.ok).toBe(false);
        expect(json.error.code).toBe("NOT_FOUND");
      });

      it("returns 400 when scopes are missing", async () => {
        const createRes = await post(
          "/keys",
          {
            type: "system",
            label: "no-scopes",
            scopes: [{ project: "x", environment: "*" }],
            permission: "read",
          },
          userKey
        );
        const prefix = ((await createRes.json()) as any).data.prefix;

        const updateRes = await put(
          `/keys/${prefix}`,
          { permission: "readwrite" },
          userKey
        );
        expect(updateRes.status).toBe(400);
        const json = (await updateRes.json()) as any;
        expect(json.error.message).toContain("Missing required fields");
      });

      it("returns 400 when permission is missing", async () => {
        const createRes = await post(
          "/keys",
          {
            type: "system",
            label: "no-perm",
            scopes: [{ project: "x", environment: "*" }],
            permission: "read",
          },
          userKey
        );
        const prefix = ((await createRes.json()) as any).data.prefix;

        const updateRes = await put(
          `/keys/${prefix}`,
          { scopes: [{ project: "y", environment: "*" }] },
          userKey
        );
        expect(updateRes.status).toBe(400);
        const json = (await updateRes.json()) as any;
        expect(json.error.message).toContain("Missing required fields");
      });

      it("returns 400 for invalid permission value", async () => {
        const createRes = await post(
          "/keys",
          {
            type: "system",
            label: "bad-perm",
            scopes: [{ project: "x", environment: "*" }],
            permission: "read",
          },
          userKey
        );
        const prefix = ((await createRes.json()) as any).data.prefix;

        const updateRes = await put(
          `/keys/${prefix}`,
          {
            scopes: [{ project: "y", environment: "*" }],
            permission: "invalid",
          },
          userKey
        );
        expect(updateRes.status).toBe(400);
        const json = (await updateRes.json()) as any;
        expect(json.error.message).toContain("Permission must be 'read' or 'readwrite'");
      });

      it("returns 403 when called with a system key", async () => {
        // Create a system key
        const sysKeyRes = await post(
          "/keys",
          {
            type: "system",
            label: "updater",
            scopes: [{ project: "x", environment: "*" }],
            permission: "readwrite",
          },
          userKey
        );
        const sysKey = ((await sysKeyRes.json()) as any).data.key;

        // Try to update using the system key (should fail)
        const updateRes = await put(
          `/keys/kfl_sys_something`,
          {
            scopes: [{ project: "y", environment: "*" }],
            permission: "read",
          },
          sysKey
        );
        expect(updateRes.status).toBe(403);
        const json = (await updateRes.json()) as any;
        expect(json.error.code).toBe("FORBIDDEN");
      });

      it("updated permission takes effect immediately", async () => {
        // Setup project + config
        await post("/projects", { name: "test-proj" }, userKey);
        await post(
          "/projects/test-proj/configs",
          { name: "production" },
          userKey
        );

        // Create read-only system key
        const createRes = await post(
          "/keys",
          {
            type: "system",
            label: "perm-test",
            scopes: [{ project: "test-proj", environment: "production" }],
            permission: "read",
          },
          userKey
        );
        const createJson = (await createRes.json()) as any;
        const prefix = createJson.data.prefix;
        const sysKey = createJson.data.key;

        // Verify it can read but not write
        const readRes = await get(
          "/projects/test-proj/configs/production/secrets",
          sysKey
        );
        expect(readRes.status).toBe(200);

        const writeRes = await put(
          "/projects/test-proj/configs/production/secrets",
          { secrets: { TEST: "value" } },
          sysKey
        );
        expect(writeRes.status).toBe(403);

        // Update to readwrite
        await put(
          `/keys/${prefix}`,
          {
            scopes: [{ project: "test-proj", environment: "production" }],
            permission: "readwrite",
          },
          userKey
        );

        // Now writing should work
        const writeRes2 = await put(
          "/projects/test-proj/configs/production/secrets",
          { secrets: { TEST: "value" } },
          sysKey
        );
        expect(writeRes2.status).toBe(200);
      });

      it("updated scopes take effect immediately", async () => {
        // Setup two projects
        await post("/projects", { name: "project-a" }, userKey);
        await post("/projects/project-a/configs", { name: "prod" }, userKey);
        await post("/projects", { name: "project-b" }, userKey);
        await post("/projects/project-b/configs", { name: "prod" }, userKey);

        // Create key scoped to project-a only
        const createRes = await post(
          "/keys",
          {
            type: "system",
            label: "scope-test",
            scopes: [{ project: "project-a", environment: "prod" }],
            permission: "readwrite",
          },
          userKey
        );
        const createJson = (await createRes.json()) as any;
        const prefix = createJson.data.prefix;
        const sysKey = createJson.data.key;

        // Can access project-a
        const aRes = await get("/projects/project-a/configs/prod/secrets", sysKey);
        expect(aRes.status).toBe(200);

        // Cannot access project-b
        const bRes = await get("/projects/project-b/configs/prod/secrets", sysKey);
        expect(bRes.status).toBe(403);

        // Update to include project-b
        await put(
          `/keys/${prefix}`,
          {
            scopes: [
              { project: "project-a", environment: "prod" },
              { project: "project-b", environment: "prod" },
            ],
            permission: "readwrite",
          },
          userKey
        );

        // Now can access both
        const aRes2 = await get("/projects/project-a/configs/prod/secrets", sysKey);
        expect(aRes2.status).toBe(200);

        const bRes2 = await get("/projects/project-b/configs/prod/secrets", sysKey);
        expect(bRes2.status).toBe(200);
      });
    });
  });

  // ─── End-to-end flow ───
  describe("End-to-end flow", () => {
    it("full lifecycle: bootstrap > project > config > secrets > delete", async () => {
      // 1. Bootstrap
      const bootstrapRes = await post("/bootstrap");
      const userKey = ((await bootstrapRes.json()) as any).data.key;

      // 2. Create project (environmentless so we control config names in this test)
      const projRes = await post(
        "/projects",
        { name: "webapp", environmentless: true },
        userKey
      );
      expect(projRes.status).toBe(201);

      // 3. Create configs
      await post(
        "/projects/webapp/configs",
        { name: "development" },
        userKey
      );
      await post(
        "/projects/webapp/configs",
        { name: "production" },
        userKey
      );

      // 4. Set secrets in development
      await put(
        "/projects/webapp/configs/development/secrets",
        {
          secrets: {
            DB_HOST: "localhost",
            DB_PORT: "5432",
            SECRET_TOKEN: "dev-token-123",
          },
        },
        userKey
      );

      // 5. Set different secrets in production
      await put(
        "/projects/webapp/configs/production/secrets",
        {
          secrets: {
            DB_HOST: "prod-db.example.com",
            DB_PORT: "5432",
            SECRET_TOKEN: "prod-token-xyz",
          },
        },
        userKey
      );

      // 6. Create a system key for CI (prod only, read)
      const sysKeyRes = await post(
        "/keys",
        {
          type: "system",
          label: "ci-reader",
          scopes: [
            { project: "webapp", environment: "production" },
          ],
          permission: "read",
        },
        userKey
      );
      const sysKey = ((await sysKeyRes.json()) as any).data.key;

      // 7. System key can read production secrets
      const prodSecretsRes = await get(
        "/projects/webapp/configs/production/secrets",
        sysKey
      );
      expect(prodSecretsRes.status).toBe(200);
      const prodSecrets = ((await prodSecretsRes.json()) as any).data.secrets;
      expect(prodSecrets.DB_HOST).toBe("prod-db.example.com");
      expect(prodSecrets.SECRET_TOKEN).toBe("prod-token-xyz");

      // 8. System key CANNOT read development secrets
      const devSecretsRes = await get(
        "/projects/webapp/configs/development/secrets",
        sysKey
      );
      expect(devSecretsRes.status).toBe(403);

      // 9. System key CANNOT write
      const writeRes = await put(
        "/projects/webapp/configs/production/secrets",
        { secrets: { HACK: "true" } },
        sysKey
      );
      expect(writeRes.status).toBe(403);

      // 10. Delete the project (cascade)
      const deleteRes = await del("/projects/webapp", userKey);
      expect(deleteRes.status).toBe(200);
      const deleteJson = (await deleteRes.json()) as any;
      expect(deleteJson.data.environments_removed).toBe(2);
      expect(deleteJson.data.secrets_removed).toBe(6);

      // 11. Project is gone
      const listRes = await get("/projects", userKey);
      const listJson = (await listRes.json()) as any;
      expect(listJson.data.projects).toHaveLength(0);
    });
  });

  // ─── 404 ───
  describe("404 handling", () => {
    it("returns 404 for unknown routes", async () => {
      const _res = await get("/nonexistent");
      // This will be 401 first because auth is required; let's use a key
      const bootstrapRes = await post("/bootstrap");
      const key = ((await bootstrapRes.json()) as any).data.key;
      const res2 = await get("/nonexistent", key);
      expect(res2.status).toBe(404);
    });
  });
});
