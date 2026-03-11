import { describeRoute, resolver, type ResponsesWithResolver } from "hono-openapi";
import {
  errorResponseSchema,
  healthResponseSchema,
  bootstrapResponseSchema,
  createKeyResponseSchema,
  listKeysResponseSchema,
  revokeKeyResponseSchema,
  updateKeyResponseSchema,
  createProjectResponseSchema,
  listProjectsResponseSchema,
  deleteProjectResponseSchema,
  createEnvironmentResponseSchema,
  listEnvironmentsResponseSchema,
  deleteEnvironmentResponseSchema,
  getSecretsResponseSchema,
  setSecretsResponseSchema,
  patchSecretsResponseSchema,
} from "../validation/response-schemas.js";

export const defaultResponses: ResponsesWithResolver = {
  400: {
    description: "Bad Request - Invalid request body or parameters",
    content: {
      "application/json": { schema: resolver(errorResponseSchema) },
    },
  },
  401: {
    description: "Unauthorized - Missing, invalid, or revoked API key",
    content: {
      "application/json": { schema: resolver(errorResponseSchema) },
    },
  },
  500: {
    description: "Internal Server Error",
    content: {
      "application/json": { schema: resolver(errorResponseSchema) },
    },
  },
};

export const forbiddenResponse: ResponsesWithResolver = {
  403: {
    description: "Forbidden - Key doesn't have required scope/permission",
    content: {
      "application/json": { schema: resolver(errorResponseSchema) },
    },
  },
};

export const notFoundResponse: ResponsesWithResolver = {
  404: {
    description: "Not Found - Resource doesn't exist",
    content: {
      "application/json": { schema: resolver(errorResponseSchema) },
    },
  },
};

export const conflictResponse: ResponsesWithResolver = {
  409: {
    description: "Conflict - Resource already exists",
    content: {
      "application/json": { schema: resolver(errorResponseSchema) },
    },
  },
};

export const describeHealthRoute = () =>
  describeRoute({
    description: "Check server health and version",
    tags: ["Health"],
    responses: {
      200: {
        description: "Server is healthy",
        content: {
          "application/json": { schema: resolver(healthResponseSchema) },
        },
      },
    },
  });

export const describeBootstrapRoute = () =>
  describeRoute({
    description:
      "Create the first user API key. Only works when no keys exist in the database.",
    tags: ["Bootstrap"],
    responses: {
      201: {
        description: "Bootstrap successful - First user key created",
        content: {
          "application/json": { schema: resolver(bootstrapResponseSchema) },
        },
      },
      409: {
        description: "Bootstrap already completed - API keys already exist",
        content: {
          "application/json": { schema: resolver(errorResponseSchema) },
        },
      },
    },
  });

export const describeListKeysRoute = () =>
  describeRoute({
    description: "List all API keys with their metadata",
    tags: ["Keys"],
    responses: {
      200: {
        description: "List of API keys",
        content: {
          "application/json": { schema: resolver(listKeysResponseSchema) },
        },
      },
      ...defaultResponses,
    },
  });

export const describeCreateKeyRoute = () =>
  describeRoute({
    description:
      "Create a new API key (user or system type). System keys require scopes and permission.",
    tags: ["Keys"],
    responses: {
      201: {
        description: "Key created successfully",
        content: {
          "application/json": { schema: resolver(createKeyResponseSchema) },
        },
      },
      ...defaultResponses,
      ...forbiddenResponse,
    },
  });

export const describeRevokeKeyRoute = () =>
  describeRoute({
    description: "Revoke an API key by its prefix",
    tags: ["Keys"],
    responses: {
      200: {
        description: "Key revoked successfully",
        content: {
          "application/json": { schema: resolver(revokeKeyResponseSchema) },
        },
      },
      ...defaultResponses,
      ...forbiddenResponse,
      ...notFoundResponse,
    },
  });

export const describeUpdateKeyRoute = () =>
  describeRoute({
    description:
      "Update a system key's scopes and permission. Replaces all existing scopes.",
    tags: ["Keys"],
    responses: {
      200: {
        description: "Key updated successfully",
        content: {
          "application/json": { schema: resolver(updateKeyResponseSchema) },
        },
      },
      ...defaultResponses,
      ...forbiddenResponse,
      ...notFoundResponse,
    },
  });

export const describeListProjectsRoute = () =>
  describeRoute({
    description:
      "List all projects. System keys only see projects within their scope.",
    tags: ["Projects"],
    responses: {
      200: {
        description: "List of projects",
        content: {
          "application/json": {
            schema: resolver(listProjectsResponseSchema),
          },
        },
      },
      ...defaultResponses,
    },
  });

export const describeCreateProjectRoute = () =>
  describeRoute({
    description:
      "Create a new project. Creates Dev and Prod environments by default unless environmentless is true.",
    tags: ["Projects"],
    responses: {
      201: {
        description: "Project created successfully",
        content: {
          "application/json": {
            schema: resolver(createProjectResponseSchema),
          },
        },
      },
      ...defaultResponses,
      ...forbiddenResponse,
      ...conflictResponse,
    },
  });

export const describeDeleteProjectRoute = () =>
  describeRoute({
    description: "Delete a project and all its environments and secrets",
    tags: ["Projects"],
    responses: {
      200: {
        description: "Project deleted successfully",
        content: {
          "application/json": {
            schema: resolver(deleteProjectResponseSchema),
          },
        },
      },
      ...defaultResponses,
      ...forbiddenResponse,
      ...notFoundResponse,
    },
  });

export const describeListEnvironmentsRoute = () =>
  describeRoute({
    description:
      "List all environments in a project. System keys only see environments within their scope.",
    tags: ["Environments"],
    responses: {
      200: {
        description: "List of environments",
        content: {
          "application/json": { schema: resolver(listEnvironmentsResponseSchema) },
        },
      },
      ...defaultResponses,
      ...notFoundResponse,
    },
  });

export const describeCreateEnvironmentRoute = () =>
  describeRoute({
    description: "Create a new environment within a project",
    tags: ["Environments"],
    responses: {
      201: {
        description: "Environment created successfully",
        content: {
          "application/json": { schema: resolver(createEnvironmentResponseSchema) },
        },
      },
      ...defaultResponses,
      ...forbiddenResponse,
      ...notFoundResponse,
      ...conflictResponse,
    },
  });

export const describeDeleteEnvironmentRoute = () =>
  describeRoute({
    description: "Delete an environment and all its secrets",
    tags: ["Environments"],
    responses: {
      200: {
        description: "Environment deleted successfully",
        content: {
          "application/json": {
            schema: resolver(deleteEnvironmentResponseSchema),
          },
        },
      },
      ...defaultResponses,
      ...forbiddenResponse,
      ...notFoundResponse,
    },
  });

export const describeGetSecretsRoute = () =>
  describeRoute({
    description:
      "Get all secrets for an environment. Returns decrypted key-value pairs.",
    tags: ["Secrets"],
    responses: {
      200: {
        description: "Secrets retrieved successfully",
        content: {
          "application/json": { schema: resolver(getSecretsResponseSchema) },
        },
      },
      ...defaultResponses,
      ...forbiddenResponse,
      ...notFoundResponse,
    },
  });

export const describeSetSecretsRoute = () =>
  describeRoute({
    description:
      "Set all secrets for an environment (full override). Deletes all existing secrets first!",
    tags: ["Secrets"],
    responses: {
      200: {
        description: "Secrets set successfully",
        content: {
          "application/json": { schema: resolver(setSecretsResponseSchema) },
        },
      },
      ...defaultResponses,
      ...forbiddenResponse,
      ...notFoundResponse,
    },
  });

export const describePatchSecretsRoute = () =>
  describeRoute({
    description:
      "Partially update secrets - set new/updated keys and/or delete specific keys",
    tags: ["Secrets"],
    responses: {
      200: {
        description: "Secrets patched successfully",
        content: {
          "application/json": {
            schema: resolver(patchSecretsResponseSchema),
          },
        },
      },
      ...defaultResponses,
      ...forbiddenResponse,
      ...notFoundResponse,
    },
  });
