import { describe, it, expect, beforeAll } from "vitest";
import { SELF, env, applyD1Migrations } from "cloudflare:test";

describe("Basic smoke tests", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  it("GET /health returns 200 and version", async () => {
    const res = await SELF.fetch("http://localhost/health");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; data: { version: string } };
    expect(json.ok).toBe(true);
    expect(json.data.version).toBe("0.1.0");
  });

  it("GET unknown route returns 404 when authenticated", async () => {
    const bootstrapRes = await SELF.fetch("http://localhost/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(bootstrapRes.status).toBe(200);
    const bootstrapJson = (await bootstrapRes.json()) as {
      ok: boolean;
      data: { key: string };
    };
    const apiKey = bootstrapJson.data.key;

    const res = await SELF.fetch("http://localhost/nonexistent", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status).toBe(404);
  });
});
