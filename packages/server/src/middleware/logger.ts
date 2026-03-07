import "hono";
import { createMiddleware } from "hono/factory";
import type { MiddlewareHandler } from "hono/types";
import { createLogger, type Logger } from "@keyflare/shared";

/**
 * @module
 * Logger Middleware for Hono. (new version, embed a logger in it)
 * - In development: logs simple, readable messages
 * - In production: logs structured JSON
 */

enum LogPrefix {
  Incoming = "Incoming request -",
  Outgoing = "Outgoing response -",
}

export const loggerMiddleware = (): MiddlewareHandler => {
  return createMiddleware(async (c, next) => {
    const { method, url } = c.req;

    const isProduction = c.env.NODE_ENV === "production";
    const logger = createLogger(isProduction);

    c.set("logger", logger);

    // NOTE: there is a bug on the log level
    const path = url.slice(url.indexOf("/", 8));

    // incoming log
    if (!isProduction) {
      logger.info(`${LogPrefix.Incoming} ${method} ${path}`);
    }

    // process request
    await next();
  });
};
