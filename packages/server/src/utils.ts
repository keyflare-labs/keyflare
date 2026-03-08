import type { ApiSuccessResponse, ApiErrorResponse, ErrorCode } from "@keyflare/shared";

export function jsonOk<T>(data: T, status = 200): Response {
  const body: ApiSuccessResponse<T> = { ok: true, data };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function jsonError(
  code: ErrorCode,
  message: string,
  status: number
): Response {
  const body: ApiErrorResponse = {
    ok: false,
    error: { code, message },
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
