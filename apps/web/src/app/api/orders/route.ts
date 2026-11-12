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
const listLimiter = createInMemoryRateLimiter(60);

export async function GET(request: Request) {
  const visitorIp = getVisitorIp(request);
  const decision = listLimiter.check(visitorIp ?? "unknown");

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

  const url = new URL(request.url);
  const rawPage = url.searchParams.get("page");
  const page =
    rawPage === null || /^\d+$/.test(rawPage) ? rawPage ?? "1" : null;

  if (page === null || Number(page) < 1) {
    return NextResponse.json(
      { error: "Invalid page." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const { response, authenticated } = await callApiWithSession(
      `/api/orders?page=${encodeURIComponent(page)}&page_size=10`,
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
      { error: "Order history is temporarily unavailable." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}

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
        timeoutMs: 30_000,
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
