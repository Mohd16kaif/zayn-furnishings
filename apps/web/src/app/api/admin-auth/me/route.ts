import { NextResponse } from "next/server";
import { NO_STORE_HEADERS, readApiJson } from "@/lib/authApi";
import { callAdminAuthApi } from "@/lib/adminAuthApi";
import {
  clearAdminSessionCookie,
  getAdminSessionToken,
} from "@/lib/adminSession";
import { getVisitorIp } from "@/lib/requestGuards";

export async function GET(request: Request) {
  const sessionToken = await getAdminSessionToken();

  if (!sessionToken) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const response = await callAdminAuthApi("/admin/me", {
      sessionToken,
      visitorIp: getVisitorIp(request),
    });
    const data = await readApiJson(response);

    if (response.status === 401) {
      const nextResponse = NextResponse.json(data, {
        status: 401,
        headers: NO_STORE_HEADERS,
      });
      clearAdminSessionCookie(nextResponse);

      return nextResponse;
    }

    return NextResponse.json(data, {
      status: response.status,
      headers: NO_STORE_HEADERS,
    });
  } catch {
    return NextResponse.json(
      { error: "Admin session is temporarily unavailable." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
