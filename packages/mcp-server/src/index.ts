#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { api } from "./client.js";

const server = new Server(
  {
    name: "keyflare",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const TOOLS = [
  // Keys
  {
    name: "list_keys",
    description: "List all API keys (requires bootstrap or an existing key).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_key",
    description: "Create a new API key. The API returns the raw key only once.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string" },
        expiresAt: { type: "string", description: "Optional ISO date string" },
      },
    },
  },
  {
    name: "update_key",
    description: "Update an API key's details.",
    inputSchema: {
      type: "object",
      properties: {
        prefix: { type: "string" },
        description: { type: "string" },
        expiresAt: { type: "string", description: "Optional ISO date string, or null to remove" },
      },
      required: ["prefix"],
    },
  },
  {
    name: "delete_key",
    description: "Revoke and delete an API key.",
    inputSchema: {
      type: "object",
      properties: {
        prefix: { type: "string" },
      },
      required: ["prefix"],
    },
  },

  // Projects
  {
    name: "list_projects",
    description: "List all projects.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_project",
    description: "Create a new project.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "delete_project",
    description: "Delete a project and all its environments.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
    },
  },

  // Environments
  {
    name: "list_environments",
    description: "List all environments in a project.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
      },
      required: ["project"],
    },
  },
  {
    name: "create_environment",
    description: "Create a new environment in a project.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
        name: { type: "string" },
      },
      required: ["project", "name"],
    },
  },
  {
    name: "delete_environment",
    description: "Delete an environment and its secrets.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
        environment: { type: "string" },
      },
      required: ["project", "environment"],
    },
  },

  // Secrets
  {
    name: "get_secrets",
    description: "Retrieve all decrypted secrets for an environment.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
        environment: { type: "string" },
      },
      required: ["project", "environment"],
    },
  },
  {
    name: "update_secrets",
    description: "Bulk replace all secrets in an environment.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
        environment: { type: "string" },
        secrets: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Key-value pairs of secrets",
        },
      },
      required: ["project", "environment", "secrets"],
    },
  },
  {
    name: "patch_secrets",
    description: "Update specific secrets in an environment without affecting others. Use null to delete a secret.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
        environment: { type: "string" },
        secrets: {
          type: "object",
          description: "Key-value pairs to update or add. Set a value to null to delete it.",
        },
      },
      required: ["project", "environment", "secrets"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const args = request.params.arguments || {};
    let data: any;

    switch (request.params.name) {
      case "list_keys":
        data = await api.get("/keys");
        break;
      case "create_key":
        data = await api.post("/keys", args);
        break;
      case "update_key": {
        const { prefix, ...rest } = args as any;
        data = await api.put(`/keys/${encodeURIComponent(prefix)}`, rest);
        break;
      }
      case "delete_key":
        data = await api.delete(`/keys/${encodeURIComponent((args as any).prefix)}`);
        break;

      case "list_projects":
        data = await api.get("/projects");
        break;
      case "create_project":
        data = await api.post("/projects", { name: (args as any).name });
        break;
      case "delete_project":
        data = await api.delete(`/projects/${encodeURIComponent((args as any).name)}`);
        break;

      case "list_environments":
        data = await api.get(`/projects/${encodeURIComponent((args as any).project)}/environments`);
        break;
      case "create_environment":
        data = await api.post(
          `/projects/${encodeURIComponent((args as any).project)}/environments`,
          { name: (args as any).name }
        );
        break;
      case "delete_environment":
        data = await api.delete(
          `/projects/${encodeURIComponent((args as any).project)}/environments/${encodeURIComponent(
            (args as any).environment
          )}`
        );
        break;

      case "get_secrets":
        data = await api.get(
          `/projects/${encodeURIComponent((args as any).project)}/environments/${encodeURIComponent(
            (args as any).environment
          )}/secrets`
        );
        break;
      case "update_secrets":
        data = await api.put(
          `/projects/${encodeURIComponent((args as any).project)}/environments/${encodeURIComponent(
            (args as any).environment
          )}/secrets`,
          { secrets: (args as any).secrets }
        );
        break;
      case "patch_secrets":
        data = await api.patch(
          `/projects/${encodeURIComponent((args as any).project)}/environments/${encodeURIComponent(
            (args as any).environment
          )}/secrets`,
          { secrets: (args as any).secrets }
        );
        break;

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}${error.code ? ` (${error.code})` : ""}\n\nStack:\n${error.stack}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  if (!process.env.KEYFLARE_API_URL) {
    console.error("Missing KEYFLARE_API_URL environment variable");
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Keyflare MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error in MCP server:", err);
  process.exit(1);
});
