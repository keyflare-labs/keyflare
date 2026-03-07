import { VERSION } from "@keyflare/shared";
import type { HealthResponse } from "@keyflare/shared";
import { drizzle } from "drizzle-orm/d1";
import { deriveMasterKeys } from "./crypto/keys.js";
import { authenticate } from "./middleware/auth.js";
import { handleBootstrap } from "./routes/bootstrap.js";
import { handleCreateKey, handleListKeys, handleRevokeKey, handleUpdateKey } from "./routes/keys.js";
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
import type { Env } from "./types.js";
import { jsonOk, jsonError } from "./utils.js";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      // ─── Health ───
      if (path === "/health" && method === "GET") {
        return jsonOk<HealthResponse>({ ok: true, version: VERSION });
      }

      // Create Drizzle D1 instance
      const db = drizzle(env.DB);

      // Derive keys from MASTER_KEY (used for all crypto operations)
      const derivedKeys = await deriveMasterKeys(env.MASTER_KEY);

      // ─── Bootstrap (unauthenticated) ───
      if (path === "/bootstrap") {
        return handleBootstrap(request, db, derivedKeys);
      }

      // ─── All other routes require auth ───
      const auth = await authenticate(request, db, derivedKeys);
      if (!auth) {
        return jsonError("UNAUTHORIZED", "Invalid or missing API key", 401);
      }

      // ─── Keys ───
      if (path === "/keys" && method === "POST") {
        return handleCreateKey(request, db, auth, derivedKeys);
      }
      if (path === "/keys" && method === "GET") {
        return handleListKeys(request, db, auth, derivedKeys);
      }
      // DELETE /keys/:prefix
      const revokeMatch = path.match(/^\/keys\/([^/]+)$/);
      if (revokeMatch && method === "DELETE") {
        return handleRevokeKey(request, db, auth, revokeMatch[1]);
      }
      // PUT /keys/:prefix
      if (revokeMatch && method === "PUT") {
        return handleUpdateKey(request, db, auth, derivedKeys, revokeMatch[1]);
      }

      // ─── Projects ───
      if (path === "/projects" && method === "POST") {
        return handleCreateProject(request, db, auth, derivedKeys);
      }
      if (path === "/projects" && method === "GET") {
        return handleListProjects(request, db, auth, derivedKeys);
      }
      // DELETE /projects/:name
      const deleteProjectMatch = path.match(/^\/projects\/([^/]+)$/);
      if (deleteProjectMatch && method === "DELETE") {
        return handleDeleteProject(
          request,
          db,
          auth,
          derivedKeys,
          decodeURIComponent(deleteProjectMatch[1])
        );
      }

      // ─── Configs (Environments) ───
      // POST /projects/:project/configs
      const createConfigMatch = path.match(
        /^\/projects\/([^/]+)\/configs$/
      );
      if (createConfigMatch && method === "POST") {
        return handleCreateConfig(
          request,
          db,
          auth,
          derivedKeys,
          decodeURIComponent(createConfigMatch[1])
        );
      }
      if (createConfigMatch && method === "GET") {
        return handleListConfigs(
          request,
          db,
          auth,
          derivedKeys,
          decodeURIComponent(createConfigMatch[1])
        );
      }
      // DELETE /projects/:project/configs/:config
      const deleteConfigMatch = path.match(
        /^\/projects\/([^/]+)\/configs\/([^/]+)$/
      );
      if (deleteConfigMatch && method === "DELETE") {
        return handleDeleteConfig(
          request,
          db,
          auth,
          derivedKeys,
          decodeURIComponent(deleteConfigMatch[1]),
          decodeURIComponent(deleteConfigMatch[2])
        );
      }

      // ─── Secrets ───
      // GET /projects/:project/configs/:config/secrets
      const secretsMatch = path.match(
        /^\/projects\/([^/]+)\/configs\/([^/]+)\/secrets$/
      );
      if (secretsMatch && method === "GET") {
        return handleGetSecrets(
          request,
          db,
          auth,
          derivedKeys,
          decodeURIComponent(secretsMatch[1]),
          decodeURIComponent(secretsMatch[2])
        );
      }
      if (secretsMatch && method === "PUT") {
        return handleSetSecrets(
          request,
          db,
          auth,
          derivedKeys,
          decodeURIComponent(secretsMatch[1]),
          decodeURIComponent(secretsMatch[2])
        );
      }
      if (secretsMatch && method === "PATCH") {
        return handlePatchSecrets(
          request,
          db,
          auth,
          derivedKeys,
          decodeURIComponent(secretsMatch[1]),
          decodeURIComponent(secretsMatch[2])
        );
      }

      // ─── 404 ───
      return jsonError("NOT_FOUND", `Route not found: ${method} ${path}`, 404);
    } catch (err) {
      console.error("Internal error:", err);
      return jsonError(
        "INTERNAL_ERROR",
        "An internal error occurred",
        500
      );
    }
  },
};
