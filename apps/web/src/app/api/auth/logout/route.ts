import { NextResponse } from "next/server";
import {
  callApiWithSession,
  clearSessionCookie,
  NO_STORE_HEADERS,
} from "@/lib/authApi";
import {
  createInMemoryRateLimiter,
  getVisitorIp,
} from "@/lib/requestGuards";

const limiter = createInMemoryRateLimiter(30);

export async function POST(request: Request) {
  const visitorIp = getVisitorIp(request);
  const decision = limiter.check(visitorIp ?? "unknown");

  if (!decision.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again shortly." },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(decision.retryAfterSeconds),
        },
      },
    );
  }

  try {
    const { response, authenticated } = await callApiWithSession(
      "/api/auth/logout",
      { method: "POST", visitorIp },
    );

    if (authenticated && response && response.status >= 500) {
      return NextResponse.json(
        { error: "Sign-out failed. Please try again." },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Sign-out failed. Please try again." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }

  const nextResponse = NextResponse.json(
    { ok: true },
    { status: 200, headers: NO_STORE_HEADERS },
  );
  clearSessionCookie(nextResponse);

  return nextResponse;
}
