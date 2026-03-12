import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

const keyScopeSchema = z
  .object({
    project: nonEmptyString,
    environment: nonEmptyString,
  })
  .strict();

export const createProjectSchema = z
  .object({
    name: nonEmptyString,
    environmentless: z.boolean().optional(),
  })
  .strict();

export const createEnvironmentSchema = z
  .object({
    name: nonEmptyString,
  })
  .strict();

export const createKeySchema = z
  .object({
    type: z.enum(["user", "system"]),
    label: nonEmptyString,
    scopes: z.array(keyScopeSchema).optional(),
    permission: z.enum(["read", "readwrite"]).optional(),
    user_email: z.string().email().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type !== "system") return;

    if (!value.scopes || value.scopes.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scopes"],
        message: "System keys require at least one scope",
      });
    }

    if (!value.permission) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["permission"],
        message: "System keys require permission: 'read' or 'readwrite'",
      });
    }
  });

export const updateKeySchema = z
  .object({
    scopes: z.array(keyScopeSchema),
    permission: z.enum(["read", "readwrite"]),
  })
  .strict();

export const setSecretsSchema = z
  .object({
    secrets: z.record(z.string()),
  })
  .strict();

export const patchSecretsSchema = z
  .object({
    set: z.record(z.string()).optional(),
    delete: z.array(nonEmptyString).optional(),
  })
  .strict()
  .refine((value) => value.set !== undefined || value.delete !== undefined, {
    message: "At least one of 'set' or 'delete' is required",
  });

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateEnvironmentInput = z.infer<typeof createEnvironmentSchema>;
export type CreateKeyInput = z.infer<typeof createKeySchema>;
export type UpdateKeyInput = z.infer<typeof updateKeySchema>;
export type SetSecretsInput = z.infer<typeof setSecretsSchema>;
export type PatchSecretsInput = z.infer<typeof patchSecretsSchema>;
