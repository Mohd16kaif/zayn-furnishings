import { NextResponse } from "next/server";
import { getSearchSuggestions } from "@/lib/publicApi";

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 40;

/**
 * Server-side proxy for search suggestions. The STOREFRONT_API_KEY secret
 * never reaches the browser; only normalized suggestion data is returned.
 */
export async function GET(request: Request) {
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

  const result = await getSearchSuggestions(query);

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
