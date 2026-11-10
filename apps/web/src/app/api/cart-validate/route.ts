import { NextResponse } from "next/server";
import {
  validateCart,
  type CartValidateItem,
} from "@/lib/publicApi";
import {
  createInMemoryRateLimiter,
  getVisitorIp,
} from "@/lib/requestGuards";

const MAX_CART_ITEMS = 50;
const ZIP_PATTERN = /^\d{5}$/;
const limiter = createInMemoryRateLimiter(60);

function parseItems(value: unknown): CartValidateItem[] | null {
  if (!Array.isArray(value) || value.length > MAX_CART_ITEMS) {
    return null;
  }

  const items: CartValidateItem[] = [];

  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      return null;
    }

    const record = entry as {
      product_id?: unknown;
      quantity?: unknown;
    };

    if (
      typeof record.product_id !== "string" ||
      typeof record.quantity !== "number" ||
      !Number.isInteger(record.quantity) ||
      record.quantity < 1 ||
      record.quantity > 10
    ) {
      return null;
    }

    items.push({
      product_id: record.product_id,
      quantity: record.quantity,
    });
  }

  return items;
}

/**
 * Server-side proxy for cart validation. The STOREFRONT_API_KEY secret stays
 * on the server and the browser only ever sees current product pricing.
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

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { error: "Invalid cart payload." },
      { status: 400 },
    );
  }

  const record = body as { items?: unknown; zip?: unknown };
  const items = parseItems(record.items);
  const zip =
    typeof record.zip === "string" && ZIP_PATTERN.test(record.zip.trim())
      ? record.zip.trim()
      : undefined;

  if (!items || (record.zip !== undefined && !zip)) {
    return NextResponse.json(
      { error: "Invalid cart payload." },
      { status: 400 },
    );
  }

  const result = await validateCart(items, zip, visitorIp);

  if (!result.ok) {
    const clientError = result.error === "HTTP 400";

    return NextResponse.json(
      {
        error: clientError
          ? "Invalid cart payload."
          : "Cart is temporarily unavailable.",
      },
      { status: clientError ? 400 : 502 },
    );
  }

  return NextResponse.json(result.data, {
    headers: { "Cache-Control": "no-store" },
  });
}
