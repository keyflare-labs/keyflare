import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import app from "../src/index.js";
import { generateSpecs } from "hono-openapi";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const docsDir = join(__dirname, "..", "..", "..", "docs");
  const outputPath = join(docsDir, "openapi.json");

  if (!existsSync(docsDir)) {
    mkdirSync(docsDir, { recursive: true });
  }

  const spec = await generateSpecs(app, {
    documentation: {
      openapi: "3.1.0",
      info: {
        title: "Keyflare API",
        version: "0.1.0",
        description:
          "Open-source secrets manager built entirely on Cloudflare. One Worker. One D1 database. Zero trust storage.",
        contact: {
          name: "Keyflare",
          url: "https://github.com/keyflare/keyflare",
        },
        license: {
          name: "MIT",
          url: "https://opensource.org/licenses/MIT",
        },
      },
      servers: [
        {
          url: "https://keyflare.YOUR_ACCOUNT.workers.dev",
          description: "Your Keyflare deployment",
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            description: "API key authentication (kfl_user_* or kfl_sys_*)",
          },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: "Health", description: "Health check endpoints" },
        { name: "Bootstrap", description: "Initial setup endpoints" },
        { name: "Keys", description: "API key management" },
        { name: "Projects", description: "Project management" },
        { name: "Configs", description: "Environment/config management" },
        { name: "Secrets", description: "Secret management" },
      ],
    },
  });

  writeFileSync(outputPath, JSON.stringify(spec, null, 2));
  console.log(`✓ OpenAPI spec generated: ${Object.keys(spec.paths || {}).length} paths`);
  console.log(`  Location: ${outputPath}`);
}

main().catch((err) => {
  console.error("Failed to generate OpenAPI spec:", err);
  process.exit(1);
});
