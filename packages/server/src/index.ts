import { Hono } from "hono";
import { VERSION } from "@keyflare/shared";
import type { HealthResponse } from "@keyflare/shared";
import { dbAndKeysMiddleware, authMiddleware } from "./middleware/hono.js";
import { loggerMiddleware } from "./middleware/logger.js";
import { handleBootstrap } from "./routes/bootstrap.js";
import {
  handleCreateKey,
  handleListKeys,
  handleRevokeKey,
  handleUpdateKey,
} from "./routes/keys.js";
import {
  handleCreateProject,
  handleListProjects,
  handleDeleteProject,
} from "./routes/projects.js";
import {
  handleCreateConfig,
  handleListConfigs,
  handleDeleteConfig,
} from "./routes/configs.js";
import {
  handleGetSecrets,
  handleSetSecrets,
  handlePatchSecrets,
} from "./routes/secrets.js";
import type { AppEnv } from "./types.js";
import { jsonOk, jsonError } from "./utils.js";

const app = new Hono<AppEnv>();

// Logger for all routes (sets c.get("logger"))
app.use("*", loggerMiddleware());

// ─── Health (no middleware) ───
app.get("/health", (c) =>
  jsonOk<HealthResponse>({ ok: true, version: VERSION })
);

// ─── Bootstrap (db + keys, no auth) ───
app.post("/bootstrap", dbAndKeysMiddleware, async (c) => {
  const db = c.get("db");
  const derivedKeys = c.get("derivedKeys");
  return handleBootstrap(c.req.raw, db, derivedKeys);
});

// ─── Keys (db + keys + auth) ───
const keysApp = new Hono<AppEnv>()
  .use("*", dbAndKeysMiddleware, authMiddleware)
  .get("/", async (c) => {
    const db = c.get("db");
    const auth = c.get("auth");
    const derivedKeys = c.get("derivedKeys");
    return handleListKeys(c.req.raw, db, auth, derivedKeys);
  })
  .post("/", async (c) => {
    const db = c.get("db");
    const auth = c.get("auth");
    const derivedKeys = c.get("derivedKeys");
    return handleCreateKey(c.req.raw, db, auth, derivedKeys);
  })
  .delete("/:prefix", async (c) => {
    const db = c.get("db");
    const auth = c.get("auth");
    const prefix = c.req.param("prefix");
    return handleRevokeKey(c.req.raw, db, auth, prefix);
  })
  .put("/:prefix", async (c) => {
    const db = c.get("db");
    const auth = c.get("auth");
    const derivedKeys = c.get("derivedKeys");
    const prefix = c.req.param("prefix");
    return handleUpdateKey(c.req.raw, db, auth, derivedKeys, prefix);
  });
app.route("/keys", keysApp);

// ─── Projects (db + keys + auth) ───
const projectsApp = new Hono<AppEnv>()
  .use("*", dbAndKeysMiddleware, authMiddleware)
  .get("/", async (c) => {
    const db = c.get("db");
    const auth = c.get("auth");
    const derivedKeys = c.get("derivedKeys");
    return handleListProjects(c.req.raw, db, auth, derivedKeys);
  })
  .post("/", async (c) => {
    const db = c.get("db");
    const auth = c.get("auth");
    const derivedKeys = c.get("derivedKeys");
    return handleCreateProject(c.req.raw, db, auth, derivedKeys);
  })
  .delete("/:name", async (c) => {
    const db = c.get("db");
    const auth = c.get("auth");
    const derivedKeys = c.get("derivedKeys");
    const name = decodeURIComponent(c.req.param("name") ?? "");
    return handleDeleteProject(c.req.raw, db, auth, derivedKeys, name);
  });

// ─── Configs: /projects/:project/configs ───
const configsApp = new Hono<AppEnv>()
  .get("/", async (c) => {
    const db = c.get("db");
    const auth = c.get("auth");
    const derivedKeys = c.get("derivedKeys");
    const project = decodeURIComponent(c.req.param("project") ?? "");
    return handleListConfigs(c.req.raw, db, auth, derivedKeys, project);
  })
  .post("/", async (c) => {
    const db = c.get("db");
    const auth = c.get("auth");
    const derivedKeys = c.get("derivedKeys");
    const project = decodeURIComponent(c.req.param("project") ?? "");
    return handleCreateConfig(c.req.raw, db, auth, derivedKeys, project);
  })
  .delete("/:config", async (c) => {
    const db = c.get("db");
    const auth = c.get("auth");
    const derivedKeys = c.get("derivedKeys");
    const project = decodeURIComponent(c.req.param("project") ?? "");
    const config = decodeURIComponent(c.req.param("config") ?? "");
    return handleDeleteConfig(
      c.req.raw,
      db,
      auth,
      derivedKeys,
      project,
      config
    );
  })
  .get("/:config/secrets", async (c) => {
    const db = c.get("db");
    const auth = c.get("auth");
    const derivedKeys = c.get("derivedKeys");
    const project = decodeURIComponent(c.req.param("project") ?? "");
    const config = decodeURIComponent(c.req.param("config") ?? "");
    return handleGetSecrets(
      c.req.raw,
      db,
      auth,
      derivedKeys,
      project,
      config
    );
  })
  .put("/:config/secrets", async (c) => {
    const db = c.get("db");
    const auth = c.get("auth");
    const derivedKeys = c.get("derivedKeys");
    const project = decodeURIComponent(c.req.param("project") ?? "");
    const config = decodeURIComponent(c.req.param("config") ?? "");
    return handleSetSecrets(
      c.req.raw,
      db,
      auth,
      derivedKeys,
      project,
      config
    );
  })
  .patch("/:config/secrets", async (c) => {
    const db = c.get("db");
    const auth = c.get("auth");
    const derivedKeys = c.get("derivedKeys");
    const project = decodeURIComponent(c.req.param("project") ?? "");
    const config = decodeURIComponent(c.req.param("config") ?? "");
    return handlePatchSecrets(
      c.req.raw,
      db,
      auth,
      derivedKeys,
      project,
      config
    );
  });

projectsApp.route("/:project/configs", configsApp);
app.route("/projects", projectsApp);

// ─── 404 ───
app.notFound((c) =>
  jsonError("NOT_FOUND", `Route not found: ${c.req.method} ${c.req.path}`, 404)
);

// ─── Global error handler ───
app.onError((err, c) => {
  c.get("logger").error("Internal error:", err);
  return jsonError("INTERNAL_ERROR", "An internal error occurred", 500);
});

export default app;
export type AppType = typeof app;
