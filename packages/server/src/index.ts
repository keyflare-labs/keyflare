import { Hono } from "hono";
import { VERSION } from "@keyflare/shared";
import type { HealthResponse } from "@keyflare/shared";
import { describeRoute, resolver } from "hono-openapi";
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
import { jsonValidator } from "./validation/middleware.js";
import {
  createConfigSchema,
  createKeySchema,
  createProjectSchema,
  patchSecretsSchema,
  setSecretsSchema,
  updateKeySchema,
} from "./validation/schemas.js";
import {
  describeHealthRoute,
  describeBootstrapRoute,
  describeCreateKeyRoute,
  describeListKeysRoute,
  describeRevokeKeyRoute,
  describeUpdateKeyRoute,
  describeCreateProjectRoute,
  describeListProjectsRoute,
  describeDeleteProjectRoute,
  describeCreateConfigRoute,
  describeListConfigsRoute,
  describeDeleteConfigRoute,
  describeGetSecretsRoute,
  describeSetSecretsRoute,
  describePatchSecretsRoute,
} from "./openapi/routes.js";

const app = new Hono<AppEnv>();

app.use("*", loggerMiddleware());

app.get(
  "/health",
  describeHealthRoute(),
  (_c) => jsonOk<HealthResponse>({ ok: true, version: VERSION })
);

app.post(
  "/bootstrap",
  describeBootstrapRoute(),
  dbAndKeysMiddleware,
  async (c) => {
    const db = c.get("db");
    const derivedKeys = c.get("derivedKeys");
    return handleBootstrap(c.req.raw, db, derivedKeys);
  }
);

const keysApp = new Hono<AppEnv>()
  .use("*", dbAndKeysMiddleware, authMiddleware)
  .get(
    "/",
    describeListKeysRoute(),
    async (c) => {
      const db = c.get("db");
      const auth = c.get("auth");
      const derivedKeys = c.get("derivedKeys");
      return handleListKeys(c.req.raw, db, auth, derivedKeys);
    }
  )
  .post(
    "/",
    describeCreateKeyRoute(),
    jsonValidator(createKeySchema),
    async (c) => {
      const db = c.get("db");
      const auth = c.get("auth");
      const derivedKeys = c.get("derivedKeys");
      const body = c.req.valid("json");
      return handleCreateKey(c.req.raw, db, auth, derivedKeys, body);
    }
  )
  .delete(
    "/:prefix",
    describeRevokeKeyRoute(),
    async (c) => {
      const db = c.get("db");
      const auth = c.get("auth");
      const prefix = c.req.param("prefix");
      return handleRevokeKey(c.req.raw, db, auth, prefix);
    }
  )
  .put(
    "/:prefix",
    describeUpdateKeyRoute(),
    jsonValidator(updateKeySchema),
    async (c) => {
      const db = c.get("db");
      const auth = c.get("auth");
      const derivedKeys = c.get("derivedKeys");
      const prefix = c.req.param("prefix");
      const body = c.req.valid("json");
      return handleUpdateKey(c.req.raw, db, auth, derivedKeys, prefix, body);
    }
  );
app.route("/keys", keysApp);

const projectsApp = new Hono<AppEnv>()
  .use("*", dbAndKeysMiddleware, authMiddleware)
  .get(
    "/",
    describeListProjectsRoute(),
    async (c) => {
      const db = c.get("db");
      const auth = c.get("auth");
      const derivedKeys = c.get("derivedKeys");
      return handleListProjects(c.req.raw, db, auth, derivedKeys);
    }
  )
  .post(
    "/",
    describeCreateProjectRoute(),
    jsonValidator(createProjectSchema),
    async (c) => {
      const db = c.get("db");
      const auth = c.get("auth");
      const derivedKeys = c.get("derivedKeys");
      const body = c.req.valid("json");
      return handleCreateProject(c.req.raw, db, auth, derivedKeys, body);
    }
  )
  .delete(
    "/:name",
    describeDeleteProjectRoute(),
    async (c) => {
      const db = c.get("db");
      const auth = c.get("auth");
      const derivedKeys = c.get("derivedKeys");
      const name = decodeURIComponent(c.req.param("name") ?? "");
      return handleDeleteProject(c.req.raw, db, auth, derivedKeys, name);
    }
  );

const configsApp = new Hono<AppEnv>()
  .get(
    "/",
    describeListConfigsRoute(),
    async (c) => {
      const db = c.get("db");
      const auth = c.get("auth");
      const derivedKeys = c.get("derivedKeys");
      const project = decodeURIComponent(c.req.param("project") ?? "");
      return handleListConfigs(c.req.raw, db, auth, derivedKeys, project);
    }
  )
  .post(
    "/",
    describeCreateConfigRoute(),
    jsonValidator(createConfigSchema),
    async (c) => {
      const db = c.get("db");
      const auth = c.get("auth");
      const derivedKeys = c.get("derivedKeys");
      const project = decodeURIComponent(c.req.param("project") ?? "");
      const body = c.req.valid("json");
      return handleCreateConfig(c.req.raw, db, auth, derivedKeys, project, body);
    }
  )
  .delete(
    "/:config",
    describeDeleteConfigRoute(),
    async (c) => {
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
    }
  )
  .get(
    "/:config/secrets",
    describeGetSecretsRoute(),
    async (c) => {
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
    }
  )
  .put(
    "/:config/secrets",
    describeSetSecretsRoute(),
    jsonValidator(setSecretsSchema),
    async (c) => {
      const db = c.get("db");
      const auth = c.get("auth");
      const derivedKeys = c.get("derivedKeys");
      const project = decodeURIComponent(c.req.param("project") ?? "");
      const config = decodeURIComponent(c.req.param("config") ?? "");
      const body = c.req.valid("json");
      return handleSetSecrets(
        c.req.raw,
        db,
        auth,
        derivedKeys,
        project,
        config,
        body
      );
    }
  )
  .patch(
    "/:config/secrets",
    describePatchSecretsRoute(),
    jsonValidator(patchSecretsSchema),
    async (c) => {
      const db = c.get("db");
      const auth = c.get("auth");
      const derivedKeys = c.get("derivedKeys");
      const project = decodeURIComponent(c.req.param("project") ?? "");
      const config = decodeURIComponent(c.req.param("config") ?? "");
      const body = c.req.valid("json");
      return handlePatchSecrets(
        c.req.raw,
        db,
        auth,
        derivedKeys,
        project,
        config,
        body
      );
    }
  );

projectsApp.route("/:project/configs", configsApp);
app.route("/projects", projectsApp);

app.notFound((c) =>
  jsonError("NOT_FOUND", `Route not found: ${c.req.method} ${c.req.path}`, 404)
);

app.onError((err, c) => {
  c.get("logger").error("Internal error:", err);
  return jsonError("INTERNAL_ERROR", "An internal error occurred", 500);
});

export default app;
export type AppType = typeof app;
