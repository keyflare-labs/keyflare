import { describe, it, expect, beforeAll } from "vitest";
import { SELF, env, applyD1Migrations } from "cloudflare:test";

/** User API key from bootstrap, set in beforeAll for authenticated tests. */
let apiKey: string;

describe("Basic smoke tests", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB_BINDING, env.TEST_MIGRATIONS);
    const bootstrapRes = await SELF.fetch("http://localhost/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(bootstrapRes.status).toBe(200);
    const json = (await bootstrapRes.json()) as { ok: boolean; data: { key: string } };
    apiKey = json.data.key;
  });

  it("GET /health returns 200 and version", async () => {
    const res = await SELF.fetch("http://localhost/health");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; data: { version: string } };
    expect(json.ok).toBe(true);
    expect(json.data.version).toBe("0.1.0");
  });

  it("GET unknown route returns 404 when authenticated", async () => {
    const res = await SELF.fetch("http://localhost/nonexistent", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status).toBe(404);
  });

  it("POST /bootstrap again returns 409", async () => {
    const res = await SELF.fetch("http://localhost/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(409);
    const json = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("CONFLICT");
  });

  it("GET /keys without auth returns 401", async () => {
    const res = await SELF.fetch("http://localhost/keys");
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("UNAUTHORIZED");
  });

  it("GET /keys with invalid key returns 401", async () => {
    const res = await SELF.fetch("http://localhost/keys", {
      headers: { Authorization: "Bearer kfl_user_invalidkey123" },
    });
    expect(res.status).toBe(401);
  });

  it("GET /keys returns 200 and lists bootstrap key", async () => {
    const res = await SELF.fetch("http://localhost/keys", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; data: { keys: unknown[] } };
    expect(json.ok).toBe(true);
    expect(json.data.keys.length).toBeGreaterThanOrEqual(1);
    const bootstrap = json.data.keys.find(
      (k: { label: string; type: string }) => k.label === "bootstrap"
    ) as { label: string; type: string } | undefined;
    expect(bootstrap).toBeDefined();
    expect(bootstrap!.type).toBe("user");
  });

  it("POST /keys creates user key and it appears in list", async () => {
    const createRes = await SELF.fetch("http://localhost/keys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ type: "user", label: "test-user-key" }),
    });
    expect(createRes.status).toBe(200);
    const createJson = (await createRes.json()) as { data: { prefix: string } };
    const prefix = createJson.data.prefix;

    const listRes = await SELF.fetch("http://localhost/keys", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as { data: { keys: { prefix: string; label: string }[] } };
    const found = listJson.data.keys.find((k) => k.prefix === prefix);
    expect(found).toBeDefined();
    expect(found!.label).toBe("test-user-key");
  });

  it("POST /keys creates system key, PUT updates scopes, DELETE revokes", async () => {
    const createRes = await SELF.fetch("http://localhost/keys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        type: "system",
        label: "ci-key",
        scopes: [{ project: "my-app", environment: "production" }],
        permission: "read",
      }),
    });
    expect(createRes.status).toBe(200);
    const createJson = (await createRes.json()) as { data: { prefix: string; key: string } };
    const prefix = createJson.data.prefix;
    const systemKey = createJson.data.key;

    const updateRes = await SELF.fetch(`http://localhost/keys/${prefix}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        scopes: [
          { project: "my-app", environment: "production" },
          { project: "my-app", environment: "staging" },
        ],
        permission: "readwrite",
      }),
    });
    expect(updateRes.status).toBe(200);
    const updateJson = (await updateRes.json()) as { data: { scopes: unknown[]; permission: string } };
    expect(updateJson.data.scopes).toHaveLength(2);
    expect(updateJson.data.permission).toBe("readwrite");

    const revokeRes = await SELF.fetch(`http://localhost/keys/${prefix}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(revokeRes.status).toBe(200);

    const useRevokedRes = await SELF.fetch("http://localhost/projects", {
      headers: { Authorization: `Bearer ${systemKey}` },
    });
    expect(useRevokedRes.status).toBe(401);
  });

  it("POST /projects creates and GET /projects lists", async () => {
    const createRes = await SELF.fetch("http://localhost/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ name: "integration-test-app" }),
    });
    expect(createRes.status).toBe(201);
    const createJson = (await createRes.json()) as { data: { name: string } };
    expect(createJson.data.name).toBe("integration-test-app");

    const listRes = await SELF.fetch("http://localhost/projects", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as { data: { projects: { name: string }[] } };
    expect(listJson.data.projects.some((p) => p.name === "integration-test-app")).toBe(true);
  });

  it("POST /projects duplicate returns 409", async () => {
    const name = "dup-project-" + Date.now();
    await SELF.fetch("http://localhost/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ name }),
    });
    const res = await SELF.fetch("http://localhost/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ name }),
    });
    expect(res.status).toBe(409);
  });

  it("POST /projects creates project with default Dev and Prod configs", async () => {
    const createRes = await SELF.fetch("http://localhost/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ name: "default-envs-project" }),
    });
    expect(createRes.status).toBe(201);
    const listRes = await SELF.fetch(
      "http://localhost/projects/default-envs-project/configs",
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as {
      data: { configs: { name: string }[] };
    };
    expect(listJson.data.configs).toHaveLength(2);
    const names = listJson.data.configs.map((c) => c.name).sort();
    expect(names).toEqual(["Dev", "Prod"]);
  });

  it("POST /projects with environmentless creates project without configs", async () => {
    const createRes = await SELF.fetch("http://localhost/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        name: "envless-project",
        environmentless: true,
      }),
    });
    expect(createRes.status).toBe(201);
    const listRes = await SELF.fetch(
      "http://localhost/projects/envless-project/configs",
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as { data: { configs: unknown[] } };
    expect(listJson.data.configs).toHaveLength(0);
  });

  it("configs and secrets: create config, set secrets, get, patch, get again", async () => {
    const project = "integration-test-app";
    const config = "production";

    // Create project and config in this test so order with other tests doesn't matter
    const createProjRes = await SELF.fetch("http://localhost/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ name: project }),
    });
    expect([201, 409]).toContain(createProjRes.status);

    const createConfigRes = await SELF.fetch(
      `http://localhost/projects/${encodeURIComponent(project)}/configs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ name: config }),
      }
    );
    expect([201, 409]).toContain(createConfigRes.status);

    const setRes = await SELF.fetch(
      `http://localhost/projects/${encodeURIComponent(project)}/configs/${encodeURIComponent(config)}/secrets`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          secrets: { DATABASE_URL: "postgres://local:5432/db", API_KEY: "secret123" },
        }),
      }
    );
    expect(setRes.status).toBe(200);

    const getRes = await SELF.fetch(
      `http://localhost/projects/${encodeURIComponent(project)}/configs/${encodeURIComponent(config)}/secrets`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    expect(getRes.status).toBe(200);
    const getJson = (await getRes.json()) as { data: { secrets: Record<string, string> } };
    expect(getJson.data.secrets.DATABASE_URL).toBe("postgres://local:5432/db");
    expect(getJson.data.secrets.API_KEY).toBe("secret123");

    const patchRes = await SELF.fetch(
      `http://localhost/projects/${encodeURIComponent(project)}/configs/${encodeURIComponent(config)}/secrets`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          set: { API_KEY: "updated-secret", NEW_VAR: "new-value" },
          delete: ["DATABASE_URL"],
        }),
      }
    );
    expect(patchRes.status).toBe(200);
    const patchJson = (await patchRes.json()) as { data: { set: number; deleted: number; total: number } };
    expect(patchJson.data.set).toBe(2);
    expect(patchJson.data.deleted).toBe(1);

    const getAfterRes = await SELF.fetch(
      `http://localhost/projects/${encodeURIComponent(project)}/configs/${encodeURIComponent(config)}/secrets`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    expect(getAfterRes.status).toBe(200);
    const getAfterJson = (await getAfterRes.json()) as { data: { secrets: Record<string, string> } };
    expect(getAfterJson.data.secrets.API_KEY).toBe("updated-secret");
    expect(getAfterJson.data.secrets.NEW_VAR).toBe("new-value");
    expect(getAfterJson.data.secrets.DATABASE_URL).toBeUndefined();
  });

  it("system key with scope can read scoped secrets only", async () => {
    const project = "scoped-test-app";
    const config = "production";

    // Create project, config, and set a secret so system key has something to read
    await SELF.fetch("http://localhost/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ name: project }),
    });
    await SELF.fetch(
      `http://localhost/projects/${encodeURIComponent(project)}/configs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ name: config }),
      }
    );
    await SELF.fetch(
      `http://localhost/projects/${encodeURIComponent(project)}/configs/${encodeURIComponent(config)}/secrets`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ secrets: { SCOPE_KEY: "scoped-value" } }),
      }
    );

    const createKeyRes = await SELF.fetch("http://localhost/keys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        type: "system",
        label: "scoped-reader",
        scopes: [{ project, environment: config }],
        permission: "read",
      }),
    });
    expect(createKeyRes.status).toBe(200);
    const keyJson = (await createKeyRes.json()) as { data: { key: string } };
    const systemKey = keyJson.data.key;

    const getRes = await SELF.fetch(
      `http://localhost/projects/${encodeURIComponent(project)}/configs/${encodeURIComponent(config)}/secrets`,
      { headers: { Authorization: `Bearer ${systemKey}` } }
    );
    expect(getRes.status).toBe(200);
    const getJson = (await getRes.json()) as { data: { secrets: Record<string, string> } };
    expect(getJson.data.secrets.SCOPE_KEY).toBe("scoped-value");

    const otherProjectRes = await SELF.fetch(
      "http://localhost/projects/other-project/configs/dev/secrets",
      { headers: { Authorization: `Bearer ${systemKey}` } }
    );
    expect(otherProjectRes.status).toBe(403);
  });
});
