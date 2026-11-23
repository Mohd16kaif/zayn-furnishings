import { NextResponse } from "next/server";
import { NO_STORE_HEADERS } from "@/lib/authApi";
import { callAdminAuthApi } from "@/lib/adminAuthApi";
import {
  clearAdminSessionCookie,
  getAdminSessionToken,
} from "@/lib/adminSession";
import {
  getVisitorIp,
  isSameOriginRequest,
} from "@/lib/requestGuards";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const sessionToken = await getAdminSessionToken();
  const visitorIp = getVisitorIp(request);

  if (sessionToken) {
    try {
      await callAdminAuthApi("/admin/auth/logout", {
        method: "POST",
        sessionToken,
        visitorIp,
      });
    } catch {
      // Clear the local cookie even if the API is unreachable.
    }
  }

  const nextResponse = NextResponse.json(
    { ok: true },
    { status: 200, headers: NO_STORE_HEADERS },
  );
  clearAdminSessionCookie(nextResponse);

  return nextResponse;
}
