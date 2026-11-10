import { NextResponse } from "next/server";
import { getSearchSuggestions } from "@/lib/publicApi";
import {
  createInMemoryRateLimiter,
  getVisitorIp,
} from "@/lib/requestGuards";

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 40;
const limiter = createInMemoryRateLimiter(60);

/**
 * Server-side proxy for search suggestions. The STOREFRONT_API_KEY secret
 * never reaches the browser; only normalized suggestion data is returned.
 *
 * The in-memory limiter is per server instance; the API limiter is the
 * durable backstop keyed to the forwarded visitor IP.
 */
export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim();

  if (
    query.length < MIN_QUERY_LENGTH ||
    query.length > MAX_QUERY_LENGTH
  ) {
    return NextResponse.json(
      { error: "Enter at least 2 characters to search." },
      { status: 400 },
    );
  }

  const result = await getSearchSuggestions(query, visitorIp);

  if (!result.ok) {
    return NextResponse.json(
      { error: "Search is temporarily unavailable." },
      { status: 502 },
    );
  }

  return NextResponse.json(result.data, {
    headers: { "Cache-Control": "public, max-age=30" },
  });
}
