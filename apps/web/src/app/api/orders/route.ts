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

const limiter = createInMemoryRateLimiter(10);

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

  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Invalid order request." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const { response, authenticated } = await callApiWithSession(
      "/api/orders",
      {
        method: "POST",
        visitorIp,
        body,
      },
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
      { error: "Order service is temporarily unavailable." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
