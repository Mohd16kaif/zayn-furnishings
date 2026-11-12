import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { apiUrl, requestHeaders } from "./publicApi";

export const SESSION_COOKIE_NAME = "zf_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const API_TIMEOUT_MS = 10_000;

export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();

  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(
    SESSION_COOKIE_NAME,
    token,
    sessionCookieOptions(),
  );
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
}

export async function callApi(
  path: string,
  options: {
    method?: "GET" | "POST";
    token?: string | null;
    visitorIp?: string | null;
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    ...requestHeaders(options.visitorIp),
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
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

export async function readApiJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function callApiWithSession(
  path: string,
  options: {
    method?: "GET" | "POST";
    visitorIp?: string | null;
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<{ response: Response | null; authenticated: boolean }> {
  const token = await getSessionToken();

  if (!token) {
    return { response: null, authenticated: false };
  }

  return {
    response: await callApi(path, { ...options, token }),
    authenticated: true,
  };
}
