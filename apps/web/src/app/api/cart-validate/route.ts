import { NextResponse } from "next/server";
import {
  validateCart,
  type CartValidateItem,
} from "@/lib/publicApi";

const MAX_CART_ITEMS = 50;

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
 */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { error: "Invalid cart payload." },
      { status: 400 },
    );
  }

  const items = parseItems((body as { items?: unknown }).items);

  if (!items) {
    return NextResponse.json(
      { error: "Invalid cart payload." },
      { status: 400 },
    );
  }

  const result = await validateCart(items);

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
