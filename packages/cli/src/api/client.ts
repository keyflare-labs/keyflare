import type { ApiResponse, ApiErrorResponse } from "@keyflare/shared";
import { hc } from "hono/client";
import { getApiUrl, readApiKey } from "../config.js";
import { makeDebug, redact } from "../debug.js";

const debug = makeDebug("api");

export class KeyflareApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "KeyflareApiError";
  }
}

function baseUrl(): string {
  const url = getApiUrl().replace(/\/$/, "") + "/";
  debug("base URL resolved: %s", url);
  return url;
}

interface KeyflareRpcClient {
  bootstrap: {
    $get: () => Promise<Response>;
    $post: () => Promise<Response>;
  };
  keys: {
    $get: () => Promise<Response>;
    $post: (opts: { json: object }) => Promise<Response>;
    ":prefix": {
      $delete: (opts: { param: { prefix: string } }) => Promise<Response>;
      $put: (opts: { param: { prefix: string }; json: object }) => Promise<Response>;
    };
  };
  projects: {
    $get: () => Promise<Response>;
    $post: (opts: { json: { name: string } }) => Promise<Response>;
    ":name": { $delete: (opts: { param: { name: string } }) => Promise<Response> };
    ":project": {
      environments: {
        $get: (opts: { param: { project: string } }) => Promise<Response>;
        $post: (opts: { param: { project: string }; json: { name: string } }) => Promise<Response>;
        ":environment": {
          $delete: (opts: { param: { project: string; environment: string } }) => Promise<Response>;
          secrets: {
            $get: (opts: { param: { project: string; environment: string } }) => Promise<Response>;
            $put: (opts: {
              param: { project: string; environment: string };
              json: { secrets: Record<string, string> };
            }) => Promise<Response>;
            $patch: (opts: {
              param: { project: string; environment: string };
              json: object;
            }) => Promise<Response>;
          };
        };
      };
    };
  };
}

function client(apiKey?: string): KeyflareRpcClient {
  const key = apiKey ?? readApiKey();
  debug("creating rpc client with apiKey=%s", redact(key));
  return hc(baseUrl(), {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  }) as unknown as KeyflareRpcClient;
}

async function unwrap<T>(resPromise: Promise<Response>): Promise<T> {
  let res: Response;
  try {
    res = await resPromise;
  } catch (err: any) {
    throw new KeyflareApiError(
      "NETWORK_ERROR",
      buildNetworkErrorMessage(err),
      0
    );
  }
  debug("response status=%d", res.status);
  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new KeyflareApiError(
      "INVALID_RESPONSE",
      buildInvalidResponseMessage(res),
      res.status
    );
  }
  if (!res.ok || !("ok" in json) || !json.ok) {
    const err = (json as ApiErrorResponse).error;
    throw new KeyflareApiError(
      err?.code ?? "UNKNOWN",
      err?.message ?? "Request failed",
      res.status
    );
  }
  return (json as { ok: true; data: T }).data;
}

/** Generic fetch wrapper that gives consistent network/parse error messages. */
async function fetchAndUnwrap<T>(request: Request | Promise<Response>): Promise<T> {
  return unwrap<T>(request instanceof Request ? fetch(request) : request);
}

async function genericFetch<T>(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown
): Promise<T> {
  return unwrap<T>(
    fetch(url, {
      method,
      headers: body
        ? { "Content-Type": "application/json", ...headers }
        : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  );
}

function buildNetworkErrorMessage(err: any): string {
  const apiUrl = getApiUrl();
  const isDefaultLocalhost = apiUrl === "http://localhost:8787";
  const msg: string = err?.message ?? String(err);
  if (
    msg.includes("ECONNREFUSED") ||
    msg.includes("fetch failed") ||
    msg.includes("Failed to fetch") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ERR_INVALID_URL")
  ) {
    const hints = isDefaultLocalhost
      ? [
          `  • It looks like you haven't configured a Keyflare instance yet.`,
          `  • Run "kfl init" to deploy a new instance, then "kfl login" to connect.`,
        ]
      : [
          `  • Check that your Keyflare instance at ${apiUrl} is running and accessible.`,
          `  • Run "kfl login" to update your API URL.`,
          `  • Set KEYFLARE_API_URL to override the configured URL.`,
        ];
    return [`Cannot connect to the Keyflare API at ${apiUrl}.`, ...hints].join("\n");
  }
  return msg;
}

function buildInvalidResponseMessage(res: Response): string {
  const apiUrl = getApiUrl();
  if (res.status >= 200 && res.status < 300) {
    return (
      `Received a non-JSON response from ${apiUrl} (HTTP ${res.status}).\n` +
      `  • The URL may point to the wrong server (e.g. a proxy or CDN).\n` +
      `  • Run "kfl login" to update your API URL.\n` +
      `  • If you haven't set up Keyflare yet, run "kfl init" first.`
    );
  }
  return (
    `Unexpected response from ${apiUrl} (HTTP ${res.status}).\n` +
    `  • The server may be misconfigured, deleted, or temporarily unavailable.\n` +
    `  • Run "kfl login" to update your API URL.\n` +
    `  • If you haven't set up Keyflare yet, run "kfl init" first.`
  );
}

export const api = {
  get: <T>(path: string, apiKey?: string): Promise<T> => {
    debug("GET %s", path);
    const c = client(apiKey);
    if (path === "/bootstrap") return unwrap<T>(c.bootstrap.$get());
    if (path === "/keys") return unwrap<T>(c.keys.$get());
    if (path === "/projects") return unwrap<T>(c.projects.$get());
    const projectEnvsMatch = path.match(/^\/projects\/([^/]+)\/environments$/);
    if (projectEnvsMatch) {
      const project = decodeURIComponent(projectEnvsMatch[1]);
      return unwrap<T>(c.projects[":project"].environments.$get({ param: { project } }));
    }
    const secretsMatch = path.match(
      /^\/projects\/([^/]+)\/environments\/([^/]+)\/secrets$/
    );
    if (secretsMatch) {
      const project = decodeURIComponent(secretsMatch[1]);
      const environment = decodeURIComponent(secretsMatch[2]);
      return unwrap<T>(
        c.projects[":project"].environments[":environment"].secrets.$get({
          param: { project, environment },
        })
      );
    }
    return genericFetch<T>(
      "GET",
      baseUrl().replace(/\/$/, "") + path,
      apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    );
  },

  post: <T>(path: string, body?: unknown, apiKey?: string): Promise<T> => {
    debug("POST %s bodyKeys=%o", path, body && typeof body === "object" ? Object.keys(body as Record<string, unknown>) : []);
    const c = client(apiKey);
    if (path === "/bootstrap") return unwrap<T>(c.bootstrap.$post());
    if (path === "/keys")
      return unwrap<T>(c.keys.$post({ json: (body ?? {}) as object }));
    if (path === "/projects")
      return unwrap<T>(c.projects.$post({ json: (body ?? {}) as { name: string } }));
    const projectEnvsMatch = path.match(/^\/projects\/([^/]+)\/environments$/);
    if (projectEnvsMatch) {
      const project = decodeURIComponent(projectEnvsMatch[1]);
      return unwrap<T>(
        c.projects[":project"].environments.$post({
          param: { project },
          json: (body ?? {}) as { name: string },
        })
      );
    }
    return genericFetch<T>(
      "POST",
      baseUrl().replace(/\/$/, "") + path,
      apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      body
    );
  },

  put: <T>(path: string, body: unknown, apiKey?: string): Promise<T> => {
    debug("PUT %s bodyType=%s", path, typeof body);
    const c = client(apiKey);
    const keysPrefixMatch = path.match(/^\/keys\/([^/]+)$/);
    if (keysPrefixMatch) {
      const prefix = keysPrefixMatch[1];
      return unwrap<T>(
        c.keys[":prefix"].$put({ param: { prefix }, json: body as object })
      );
    }
    const secretsMatch = path.match(
      /^\/projects\/([^/]+)\/environments\/([^/]+)\/secrets$/
    );
    if (secretsMatch) {
      const project = decodeURIComponent(secretsMatch[1]);
      const environment = decodeURIComponent(secretsMatch[2]);
      return unwrap<T>(
        c.projects[":project"].environments[":environment"].secrets.$put({
          param: { project, environment },
          json: body as { secrets: Record<string, string> },
        })
      );
    }
    return genericFetch<T>(
      "PUT",
      baseUrl().replace(/\/$/, "") + path,
      apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      body
    );
  },

  patch: <T>(path: string, body: unknown, apiKey?: string): Promise<T> => {
    debug("PATCH %s bodyType=%s", path, typeof body);
    const c = client(apiKey);
    const secretsMatch = path.match(
      /^\/projects\/([^/]+)\/environments\/([^/]+)\/secrets$/
    );
    if (secretsMatch) {
      const project = decodeURIComponent(secretsMatch[1]);
      const environment = decodeURIComponent(secretsMatch[2]);
      return unwrap<T>(
        c.projects[":project"].environments[":environment"].secrets.$patch({
          param: { project, environment },
          json: body as object,
        })
      );
    }
    return genericFetch<T>(
      "PATCH",
      baseUrl().replace(/\/$/, "") + path,
      apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      body
    );
  },

  delete: <T>(path: string, apiKey?: string): Promise<T> => {
    debug("DELETE %s", path);
    const c = client(apiKey);
    const keysPrefixMatch = path.match(/^\/keys\/([^/]+)$/);
    if (keysPrefixMatch) {
      const prefix = keysPrefixMatch[1];
      return unwrap<T>(c.keys[":prefix"].$delete({ param: { prefix } }));
    }
    const projectMatch = path.match(/^\/projects\/([^/]+)$/);
    if (projectMatch) {
      const name = decodeURIComponent(projectMatch[1]);
      return unwrap<T>(c.projects[":name"].$delete({ param: { name } }));
    }
    const envMatch = path.match(/^\/projects\/([^/]+)\/environments\/([^/]+)$/);
    if (envMatch) {
      const project = decodeURIComponent(envMatch[1]);
      const environment = decodeURIComponent(envMatch[2]);
      return unwrap<T>(
        c.projects[":project"].environments[":environment"].$delete({
          param: { project, environment },
        })
      );
    }
    return genericFetch<T>(
      "DELETE",
      baseUrl().replace(/\/$/, "") + path,
      apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    );
  },
};
