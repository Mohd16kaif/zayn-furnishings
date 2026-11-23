import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE_NAME,
  adminSessionCookieOptions,
} from "./adminSessionOptions";

export {
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  adminSessionCookieOptions,
} from "./adminSessionOptions";

/** Server-only admin session cookie helpers. Never import in client code. */
export async function getAdminSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();

  return cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value ?? null;
}

export function setAdminSessionCookie(
  response: NextResponse,
  token: string,
): void {
  response.cookies.set(
    ADMIN_SESSION_COOKIE_NAME,
    token,
    adminSessionCookieOptions(),
  );
}

export function clearAdminSessionCookie(response: NextResponse): void {
  response.cookies.set(ADMIN_SESSION_COOKIE_NAME, "", {
    ...adminSessionCookieOptions(),
    maxAge: 0,
  });
}
