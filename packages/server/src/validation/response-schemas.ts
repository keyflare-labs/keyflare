import { z } from "zod";

export const errorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum([
      "BAD_REQUEST",
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "CONFLICT",
      "INTERNAL_ERROR",
    ]),
    message: z.string(),
  }),
});

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    ok: z.literal(true),
    version: z.string(),
  }),
});

export const keyScopeSchema = z.object({
  project: z.string(),
  environment: z.string(),
});

export const bootstrapStatusResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    initialized: z.boolean(),
  }),
});

export const bootstrapResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    key: z.string(),
    prefix: z.string(),
    type: z.literal("user"),
    label: z.string(),
    user_email: z.string().nullable(),
  }),
});

export const createKeyResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    key: z.string(),
    prefix: z.string(),
    type: z.enum(["user", "system"]),
    label: z.string(),
    scopes: z.array(keyScopeSchema).nullable(),
    permission: z.string(),
    user_email: z.string().nullable(),
  }),
});

export const keyInfoSchema = z.object({
  id: z.string(),
  prefix: z.string(),
  type: z.enum(["user", "system"]),
  label: z.string(),
  scopes: z.array(keyScopeSchema).nullable(),
  permission: z.string(),
  user_email: z.string().nullable(),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
  revoked: z.boolean(),
});

export const listKeysResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    keys: z.array(keyInfoSchema),
  }),
});

export const revokeKeyResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    revoked: z.string(),
  }),
});

export const updateKeyResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    prefix: z.string(),
    type: z.enum(["user", "system"]),
    label: z.string(),
    scopes: z.array(keyScopeSchema),
    permission: z.string(),
  }),
});

export const createProjectResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    id: z.string(),
    name: z.string(),
    created_at: z.string(),
  }),
});

export const projectInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  environment_count: z.number(),
  created_at: z.string(),
});

export const listProjectsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    projects: z.array(projectInfoSchema),
  }),
});

export const deleteProjectResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    deleted: z.string(),
    environments_removed: z.number(),
    secrets_removed: z.number(),
  }),
});

export const createEnvironmentResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    id: z.string(),
    name: z.string(),
    project: z.string(),
    created_at: z.string(),
  }),
});

export const environmentInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  secret_count: z.number(),
  created_at: z.string(),
});

export const listEnvironmentsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    environments: z.array(environmentInfoSchema),
  }),
});

export const deleteEnvironmentResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    deleted: z.string(),
    project: z.string(),
    secrets_removed: z.number(),
  }),
});

export const getSecretsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    secrets: z.record(z.string()),
  }),
});

export const setSecretsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    count: z.number(),
    project: z.string(),
    environment: z.string(),
  }),
});

export const patchSecretsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    set: z.number(),
    deleted: z.number(),
    total: z.number(),
  }),
});
