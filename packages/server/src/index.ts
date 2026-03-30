import { Hono } from "hono";
import { VERSION } from "@keyflare/shared";
import type { HealthResponse, AuthVerifyResponse } from "@keyflare/shared";
import { dbAndKeysMiddleware, authMiddleware } from "./middleware/hono.js";
import { loggerMiddleware } from "./middleware/logger.js";
import { handleBootstrap, handleBootstrapStatus } from "./routes/bootstrap.js";
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
  handleCreateEnvironment,
  handleListEnvironments,
  handleDeleteEnvironment,
} from "./routes/environments.js";
import {
  handleGetSecrets,
  handleSetSecrets,
  handlePatchSecrets,
} from "./routes/secrets.js";
import type { AppEnv } from "./types.js";
import { jsonOk, jsonError } from "./utils.js";
import { jsonValidator } from "./validation/middleware.js";
import {
  createEnvironmentSchema,
  createKeySchema,
  createProjectSchema,
  patchSecretsSchema,
  setSecretsSchema,
  updateKeySchema,
} from "./validation/schemas.js";
import {
  describeHealthRoute,
  describeBootstrapStatusRoute,
  describeBootstrapRoute,
  describeCreateKeyRoute,
  describeListKeysRoute,
  describeRevokeKeyRoute,
  describeUpdateKeyRoute,
  describeCreateProjectRoute,
  describeListProjectsRoute,
  describeDeleteProjectRoute,
  describeCreateEnvironmentRoute,
  describeListEnvironmentsRoute,
  describeDeleteEnvironmentRoute,
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

app.get(
  "/auth/verify",
  dbAndKeysMiddleware,
  authMiddleware,
  async (c) => {
    const auth = c.get("auth");
    const db = c.get("db");
    const derivedKeys = c.get("derivedKeys");
    // Look up the key prefix from the Authorization header
    const { sha256 } = await import("./crypto/hash.js");
    const apiKey = c.req.header("Authorization")?.slice(7).trim() ?? "";
    const keyHash = await sha256(apiKey);
    const { getKeyByHash } = await import("./db/queries.js");
    const row = await getKeyByHash(db, keyHash);
    return jsonOk<AuthVerifyResponse>({
      key_type: auth.keyType,
      key_prefix: row?.keyPrefix ?? "",
    });
  }
);

app.get(
  "/bootstrap",
  describeBootstrapStatusRoute(),
  dbAndKeysMiddleware,
  async (c) => {
    const db = c.get("db");
    return handleBootstrapStatus(c.req.raw, db);
  }
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

const environmentsApp = new Hono<AppEnv>()
  .get(
    "/",
    describeListEnvironmentsRoute(),
    async (c) => {
      const db = c.get("db");
      const auth = c.get("auth");
      const derivedKeys = c.get("derivedKeys");
      const project = decodeURIComponent(c.req.param("project") ?? "");
      return handleListEnvironments(c.req.raw, db, auth, derivedKeys, project);
    }
  )
  .post(
    "/",
    describeCreateEnvironmentRoute(),
    jsonValidator(createEnvironmentSchema),
    async (c) => {
      const db = c.get("db");
      const auth = c.get("auth");
      const derivedKeys = c.get("derivedKeys");
      const project = decodeURIComponent(c.req.param("project") ?? "");
      const body = c.req.valid("json");
      return handleCreateEnvironment(c.req.raw, db, auth, derivedKeys, project, body);
    }
  )
  .delete(
    "/:environment",
    describeDeleteEnvironmentRoute(),
    async (c) => {
      const db = c.get("db");
      const auth = c.get("auth");
      const derivedKeys = c.get("derivedKeys");
      const project = decodeURIComponent(c.req.param("project") ?? "");
      const environment = decodeURIComponent(c.req.param("environment") ?? "");
      return handleDeleteEnvironment(
        c.req.raw,
        db,
        auth,
        derivedKeys,
        project,
        environment
      );
    }
  )
  .get(
    "/:environment/secrets",
    describeGetSecretsRoute(),
    async (c) => {
      const db = c.get("db");
      const auth = c.get("auth");
      const derivedKeys = c.get("derivedKeys");
      const project = decodeURIComponent(c.req.param("project") ?? "");
      const environment = decodeURIComponent(c.req.param("environment") ?? "");
      return handleGetSecrets(
        c.req.raw,
        db,
        auth,
        derivedKeys,
        project,
        environment
      );
    }
  )
  .put(
    "/:environment/secrets",
    describeSetSecretsRoute(),
    jsonValidator(setSecretsSchema),
    async (c) => {
      const db = c.get("db");
      const auth = c.get("auth");
      const derivedKeys = c.get("derivedKeys");
      const project = decodeURIComponent(c.req.param("project") ?? "");
      const environment = decodeURIComponent(c.req.param("environment") ?? "");
      const body = c.req.valid("json");
      return handleSetSecrets(
        c.req.raw,
        db,
        auth,
        derivedKeys,
        project,
        environment,
        body
      );
    }
  )
  .patch(
    "/:environment/secrets",
    describePatchSecretsRoute(),
    jsonValidator(patchSecretsSchema),
    async (c) => {
      const db = c.get("db");
      const auth = c.get("auth");
      const derivedKeys = c.get("derivedKeys");
      const project = decodeURIComponent(c.req.param("project") ?? "");
      const environment = decodeURIComponent(c.req.param("environment") ?? "");
      const body = c.req.valid("json");
      return handlePatchSecrets(
        c.req.raw,
        db,
        auth,
        derivedKeys,
        project,
        environment,
        body
      );
    }
  );

projectsApp.route("/:project/environments", environmentsApp);
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
