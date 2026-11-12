import { NextResponse } from "next/server";
import { previewDiscount } from "@/lib/publicApi";
import {
  createInMemoryRateLimiter,
  getVisitorIp,
} from "@/lib/requestGuards";

const MAX_CART_ITEMS = 50;
const limiter = createInMemoryRateLimiter(20);

export async function POST(request: Request) {
  const visitorIp = getVisitorIp(request);
  const decision = limiter.check(visitorIp ?? "unknown");

  if (!decision.allowed) {
    return NextResponse.json(
      { error: "Too many discount attempts. Please try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(decision.retryAfterSeconds) },
      },
    );
  }

  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { error: "Invalid discount request." },
      { status: 400 },
    );
  }

  const record = body as { items?: unknown; discount_code?: unknown };
  const rawCode =
    typeof record.discount_code === "string"
      ? record.discount_code.trim()
      : "";

  if (
    !Array.isArray(record.items) ||
    record.items.length === 0 ||
    record.items.length > MAX_CART_ITEMS ||
    rawCode.length === 0 ||
    rawCode.length > 64
  ) {
    return NextResponse.json(
      { error: "Invalid discount request." },
      { status: 400 },
    );
  }

  const items: Array<{ product_id: string; quantity: number }> = [];

  for (const entry of record.items) {
    if (typeof entry !== "object" || entry === null) {
      return NextResponse.json(
        { error: "Invalid discount request." },
        { status: 400 },
      );
    }

    const item = entry as { product_id?: unknown; quantity?: unknown };

    if (
      typeof item.product_id !== "string" ||
      typeof item.quantity !== "number" ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 10
    ) {
      return NextResponse.json(
        { error: "Invalid discount request." },
        { status: 400 },
      );
    }

    items.push({
      product_id: item.product_id,
      quantity: item.quantity,
    });
  }

  const result = await previewDiscount(items, rawCode, visitorIp);

  if (!result.data) {
    return NextResponse.json(
      { error: "Discounts are temporarily unavailable." },
      { status: result.status >= 400 ? result.status : 502 },
    );
  }

  return NextResponse.json(result.data, {
    status: result.ok ? 200 : result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
