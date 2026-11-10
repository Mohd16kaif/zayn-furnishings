import { NextResponse } from "next/server";
import { checkDelivery } from "@/lib/publicApi";
import {
  createInMemoryRateLimiter,
  getVisitorIp,
} from "@/lib/requestGuards";

const ZIP_PATTERN = /^\d{5}$/;
const limiter = createInMemoryRateLimiter(30);

/**
 * Server-side proxy for the public delivery check. The STOREFRONT_API_KEY
 * secret never reaches the browser, the ZIP travels in the POST body only
 * (never in URLs), and a successful check stores it in a 30-day cookie.
 *
 * The in-memory limiter is per server instance; the API limiter is the
 * durable backstop keyed to the forwarded visitor IP.
 */
export async function POST(request: Request) {
  const visitorIp = getVisitorIp(request);
  const decision = limiter.check(visitorIp ?? "unknown");

  if (!decision.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": String(decision.retryAfterSeconds),
        },
      },
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : null;
  const rawZip = record?.zip;
  const zip = typeof rawZip === "string" ? rawZip.trim() : "";
  const rawSubtotal = record?.subtotal_cents;
  const subtotalCents =
    rawSubtotal === undefined
      ? undefined
      : typeof rawSubtotal === "number" &&
          Number.isInteger(rawSubtotal) &&
          rawSubtotal >= 0
        ? rawSubtotal
        : null;

  if (!ZIP_PATTERN.test(zip) || subtotalCents === null) {
    return NextResponse.json(
      { error: "Enter a valid ZIP and subtotal." },
      { status: 400 },
    );
  }

  const result = await checkDelivery(
    zip,
    subtotalCents,
    visitorIp,
  );

  const response = NextResponse.json(result.data, { status: 200 });

  if (result.ok && result.data.available) {
    response.cookies.set("zf-zip", zip, {
      maxAge: 60 * 60 * 24 * 30,
      sameSite: "lax",
      path: "/",
    });
  }

  return response;
}
