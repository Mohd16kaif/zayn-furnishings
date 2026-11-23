import { NextResponse } from "next/server";
import { NO_STORE_HEADERS, readApiJson } from "@/lib/authApi";
import { callAdminAuthApi } from "@/lib/adminAuthApi";
import {
  createInMemoryRateLimiter,
  getVisitorIp,
  isSameOriginRequest,
} from "@/lib/requestGuards";

const limiter = createInMemoryRateLimiter(5);

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

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
    const response = await callAdminAuthApi(
      "/admin/auth/code/request",
      { method: "POST", visitorIp, body },
    );
    const data = await readApiJson(response);

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
