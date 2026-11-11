import { NextResponse } from "next/server";
import {
  callApi,
  NO_STORE_HEADERS,
  readApiJson,
  setSessionCookie,
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
      { error: "Invalid request." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const response = await callApi("/api/auth/phone/verify", {
      method: "POST",
      visitorIp,
      body,
    });
    const data = await readApiJson(response);

    if (
      response.status === 200 &&
      typeof data === "object" &&
      data !== null &&
      typeof (data as { token?: unknown }).token === "string"
    ) {
      const payload = data as {
        token: string;
        customer?: unknown;
      };
      const nextResponse = NextResponse.json(
        { customer: payload.customer ?? null },
        { status: 200, headers: NO_STORE_HEADERS },
      );

      setSessionCookie(nextResponse, payload.token);

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
