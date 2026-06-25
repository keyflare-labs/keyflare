import type { ApiResponse, ApiErrorResponse } from "@keyflare/shared";
import { hc } from "hono/client";

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

function getApiUrl(): string {
  const url = process.env.KEYFLARE_API_URL;
  if (!url) {
    throw new Error("KEYFLARE_API_URL is not set");
  }
  return url.replace(/\/$/, "") + "/";
}

function getApiKey(): string | undefined {
  return process.env.KEYFLARE_API_KEY;
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
  const key = apiKey ?? getApiKey();
  return hc(getApiUrl(), {
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

export const api = {
  get: <T>(path: string, apiKey?: string): Promise<T> => {
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
    
    // Fallback using raw fetch
    return fetch(getApiUrl().replace(/\/$/, "") + path, {
      method: "GET",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : (getApiKey() ? { Authorization: `Bearer ${getApiKey()}` } : {}),
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
    return fetch(getApiUrl().replace(/\/$/, "") + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : (getApiKey() ? { Authorization: `Bearer ${getApiKey()}` } : {})),
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
    return fetch(getApiUrl().replace(/\/$/, "") + path, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : (getApiKey() ? { Authorization: `Bearer ${getApiKey()}` } : {})),
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
    return fetch(getApiUrl().replace(/\/$/, "") + path, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : (getApiKey() ? { Authorization: `Bearer ${getApiKey()}` } : {})),
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
    return fetch(getApiUrl().replace(/\/$/, "") + path, {
      method: "DELETE",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : (getApiKey() ? { Authorization: `Bearer ${getApiKey()}` } : {}),
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
