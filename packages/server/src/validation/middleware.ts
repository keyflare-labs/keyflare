import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { jsonError } from "../utils.js";

export function jsonValidator<T extends z.ZodTypeAny>(schema: T) {
  return zValidator("json", schema, (result) => {
    if (result.success) return;

    const message = result.error.issues.map((issue) => issue.message).join("; ");
    return jsonError("BAD_REQUEST", message || "Invalid request body", 400);
  });
}
