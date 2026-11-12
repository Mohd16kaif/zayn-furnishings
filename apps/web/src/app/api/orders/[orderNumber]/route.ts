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

const limiter = createInMemoryRateLimiter(120);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderNumber: string }> },
) {
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

  const { orderNumber } = await params;
  const normalized = orderNumber.trim();

  if (!normalized || normalized.length > 40) {
    return NextResponse.json(
      { error: "Order not found." },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const { response, authenticated } = await callApiWithSession(
      `/api/orders/${encodeURIComponent(normalized)}`,
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
      { error: "Order service is temporarily unavailable." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
