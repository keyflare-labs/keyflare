// Keyflare Server — Cloudflare Worker entry point
// TODO: Implement API routes
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return new Response("Keyflare API — not yet implemented", { status: 501 });
  },
};

interface Env {
  DB: D1Database;
  MASTER_KEY: string;
}
