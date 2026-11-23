import { apiUrl, requestHeaders } from "./publicApi";

const API_TIMEOUT_MS = 10_000;

export async function callAdminAuthApi(
  path: string,
  options: {
    method?: "GET" | "POST";
    sessionToken?: string | null;
    visitorIp?: string | null;
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    ...requestHeaders(options.visitorIp),
  };

  if (options.sessionToken) {
    headers["x-admin-session"] = options.sessionToken;
  }

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  return fetch(`${apiUrl()}${path}`, {
    method: options.method ?? "GET",
    headers,
    body:
      options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs ?? API_TIMEOUT_MS),
  });
}
