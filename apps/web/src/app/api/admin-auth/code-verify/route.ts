import { NextResponse } from "next/server";
import { NO_STORE_HEADERS, readApiJson } from "@/lib/authApi";
import { callAdminAuthApi } from "@/lib/adminAuthApi";
import { setAdminSessionCookie } from "@/lib/adminSession";
import {
  createInMemoryRateLimiter,
  getVisitorIp,
  isSameOriginRequest,
} from "@/lib/requestGuards";

const limiter = createInMemoryRateLimiter(10);

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
      "/admin/auth/code/verify",
      { method: "POST", visitorIp, body },
    );
    const data = await readApiJson(response);

    if (response.status === 200) {
      if (
        typeof data !== "object" ||
        data === null ||
        typeof (data as { sessionToken?: unknown }).sessionToken !==
          "string"
      ) {
        return NextResponse.json(
          { error: "Sign-in is temporarily unavailable." },
          { status: 502, headers: NO_STORE_HEADERS },
        );
      }

      const payload = data as {
        sessionToken: string;
        expiresAt?: unknown;
        admin?: unknown;
      };
      const admin =
        typeof payload.admin === "object" && payload.admin !== null
          ? (payload.admin as {
              email?: unknown;
              name?: unknown;
              role?: unknown;
            })
          : null;
      const nextResponse = NextResponse.json(
        {
          admin: admin
            ? {
                email:
                  typeof admin.email === "string" ? admin.email : null,
                name: typeof admin.name === "string" ? admin.name : null,
                role:
                  typeof admin.role === "string" ? admin.role : null,
              }
            : null,
          expiresAt:
            typeof payload.expiresAt === "string"
              ? payload.expiresAt
              : null,
        },
        { status: 200, headers: NO_STORE_HEADERS },
      );

      setAdminSessionCookie(nextResponse, payload.sessionToken);

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
