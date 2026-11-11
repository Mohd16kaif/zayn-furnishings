import { NextResponse } from "next/server";
import {
  callApiWithSession,
  clearSessionCookie,
  NO_STORE_HEADERS,
  readApiJson,
} from "@/lib/authApi";
import {
  createInMemoryRateLimiter,
  getVisitorIp,
} from "@/lib/requestGuards";

const limiter = createInMemoryRateLimiter(60);

export async function GET(request: Request) {
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
      "/api/auth/me",
      { visitorIp },
    );

    if (!authenticated || !response) {
      return NextResponse.json(
        { error: "Sign in required." },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const data = await readApiJson(response);

    if (response.status === 401) {
      const nextResponse = NextResponse.json(data, {
        status: 401,
        headers: NO_STORE_HEADERS,
      });
      clearSessionCookie(nextResponse);

      return nextResponse;
    }

    return NextResponse.json(data, {
      status: response.status,
      headers: NO_STORE_HEADERS,
    });
  } catch {
    return NextResponse.json(
      { error: "Sign-in is temporarily unavailable." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
