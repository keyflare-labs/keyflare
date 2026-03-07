import type { ApiResponse, ApiErrorResponse } from "@keyflare/shared";
import { hc } from "hono/client";
import { getApiUrl, readApiKey } from "../config.js";

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
  return getApiUrl().replace(/\/$/, "") + "/";
}

/** Explicit RPC client shape so we get typed usage without deep AppType inference. */
interface KeyflareRpcClient {
  bootstrap: { $post: () => Promise<Response> };
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
      configs: {
        $get: (opts: { param: { project: string } }) => Promise<Response>;
        $post: (opts: { param: { project: string }; json: { name: string } }) => Promise<Response>;
        ":config": {
          $delete: (opts: { param: { project: string; config: string } }) => Promise<Response>;
          secrets: {
            $get: (opts: { param: { project: string; config: string } }) => Promise<Response>;
            $put: (opts: {
              param: { project: string; config: string };
              json: { secrets: Record<string, string> };
            }) => Promise<Response>;
            $patch: (opts: {
              param: { project: string; config: string };
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
  return hc(baseUrl(), {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  }) as unknown as KeyflareRpcClient;
}

async function unwrap<T>(resPromise: Promise<Response>): Promise<T> {
  const res = await resPromise;
  const json = (await res.json()) as ApiResponse<T>;
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

/**
 * RPC-based API client. Same interface as before so commands are unchanged.
 */
export const api = {
  get: <T>(path: string, apiKey?: string): Promise<T> => {
    const c = client(apiKey);
    if (path === "/keys") return unwrap<T>(c.keys.$get());
    if (path === "/projects") return unwrap<T>(c.projects.$get());
    const projectConfigsMatch = path.match(/^\/projects\/([^/]+)\/configs$/);
    if (projectConfigsMatch) {
      const project = decodeURIComponent(projectConfigsMatch[1]);
      return unwrap<T>(c.projects[":project"].configs.$get({ param: { project } }));
    }
    const secretsMatch = path.match(
      /^\/projects\/([^/]+)\/configs\/([^/]+)\/secrets$/
    );
    if (secretsMatch) {
      const project = decodeURIComponent(secretsMatch[1]);
      const config = decodeURIComponent(secretsMatch[2]);
      return unwrap<T>(
        c.projects[":project"].configs[":config"].secrets.$get({
          param: { project, config },
        })
      );
    }
    return fetch(baseUrl().replace(/\/$/, "") + path, {
      method: "GET",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    }).then((r) =>
      r.json().then((j) => {
        const json = j as { ok?: boolean; data?: T; error?: { code: string; message: string } };
        if (!r.ok || !json.ok)
          throw new KeyflareApiError(
            json.error?.code ?? "UNKNOWN",
            json.error?.message ?? "Request failed",
            r.status
          );
        return json.data as T;
      })
    );
  },

  post: <T>(path: string, body?: unknown, apiKey?: string): Promise<T> => {
    const c = client(apiKey);
    if (path === "/bootstrap") return unwrap<T>(c.bootstrap.$post());
    if (path === "/keys")
      return unwrap<T>(c.keys.$post({ json: (body ?? {}) as object }));
    if (path === "/projects")
      return unwrap<T>(c.projects.$post({ json: (body ?? {}) as { name: string } }));
    const projectConfigsMatch = path.match(/^\/projects\/([^/]+)\/configs$/);
    if (projectConfigsMatch) {
      const project = decodeURIComponent(projectConfigsMatch[1]);
      return unwrap<T>(
        c.projects[":project"].configs.$post({
          param: { project },
          json: (body ?? {}) as { name: string },
        })
      );
    }
    return fetch(baseUrl().replace(/\/$/, "") + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) =>
      r.json().then((j) => {
        const json = j as { ok?: boolean; data?: T; error?: { code: string; message: string } };
        if (!r.ok || !json.ok)
          throw new KeyflareApiError(
            json.error?.code ?? "UNKNOWN",
            json.error?.message ?? "Request failed",
            r.status
          );
        return json.data as T;
      })
    );
  },

  put: <T>(path: string, body: unknown, apiKey?: string): Promise<T> => {
    const c = client(apiKey);
    const keysPrefixMatch = path.match(/^\/keys\/([^/]+)$/);
    if (keysPrefixMatch) {
      const prefix = keysPrefixMatch[1];
      return unwrap<T>(
        c.keys[":prefix"].$put({ param: { prefix }, json: body as object })
      );
    }
    const secretsMatch = path.match(
      /^\/projects\/([^/]+)\/configs\/([^/]+)\/secrets$/
    );
    if (secretsMatch) {
      const project = decodeURIComponent(secretsMatch[1]);
      const config = decodeURIComponent(secretsMatch[2]);
      return unwrap<T>(
        c.projects[":project"].configs[":config"].secrets.$put({
          param: { project, config },
          json: body as { secrets: Record<string, string> },
        })
      );
    }
    return fetch(baseUrl().replace(/\/$/, "") + path, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    }).then((r) =>
      r.json().then((j) => {
        const json = j as { ok?: boolean; data?: T; error?: { code: string; message: string } };
        if (!r.ok || !json.ok)
          throw new KeyflareApiError(
            json.error?.code ?? "UNKNOWN",
            json.error?.message ?? "Request failed",
            r.status
          );
        return json.data as T;
      })
    );
  },

  patch: <T>(path: string, body: unknown, apiKey?: string): Promise<T> => {
    const c = client(apiKey);
    const secretsMatch = path.match(
      /^\/projects\/([^/]+)\/configs\/([^/]+)\/secrets$/
    );
    if (secretsMatch) {
      const project = decodeURIComponent(secretsMatch[1]);
      const config = decodeURIComponent(secretsMatch[2]);
      return unwrap<T>(
        c.projects[":project"].configs[":config"].secrets.$patch({
          param: { project, config },
          json: body as object,
        })
      );
    }
    return fetch(baseUrl().replace(/\/$/, "") + path, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    }).then((r) =>
      r.json().then((j) => {
        const json = j as { ok?: boolean; data?: T; error?: { code: string; message: string } };
        if (!r.ok || !json.ok)
          throw new KeyflareApiError(
            json.error?.code ?? "UNKNOWN",
            json.error?.message ?? "Request failed",
            r.status
          );
        return json.data as T;
      })
    );
  },

  delete: <T>(path: string, apiKey?: string): Promise<T> => {
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
    const configMatch = path.match(/^\/projects\/([^/]+)\/configs\/([^/]+)$/);
    if (configMatch) {
      const project = decodeURIComponent(configMatch[1]);
      const config = decodeURIComponent(configMatch[2]);
      return unwrap<T>(
        c.projects[":project"].configs[":config"].$delete({
          param: { project, config },
        })
      );
    }
    return fetch(baseUrl().replace(/\/$/, "") + path, {
      method: "DELETE",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    }).then((r) =>
      r.json().then((j) => {
        const json = j as { ok?: boolean; data?: T; error?: { code: string; message: string } };
        if (!r.ok || !json.ok)
          throw new KeyflareApiError(
            json.error?.code ?? "UNKNOWN",
            json.error?.message ?? "Request failed",
            r.status
          );
        return json.data as T;
      })
    );
  },
};
