import { NextResponse } from "next/server";
import { checkDelivery } from "@/lib/publicApi";

const ZIP_PATTERN = /^\d{5}$/;

/**
 * Server-side proxy for the public delivery check. The STOREFRONT_API_KEY
 * secret never reaches the browser, the ZIP travels in the POST body only
 * (never in URLs), and a successful check stores it in a 30-day cookie.
 */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const zip =
    typeof body === "object" &&
    body !== null &&
    typeof (body as Record<string, unknown>).zip === "string"
      ? (body as Record<string, string>).zip.trim()
      : "";

  if (!ZIP_PATTERN.test(zip)) {
    return NextResponse.json(
      { error: "Enter a 5-digit US ZIP code." },
      { status: 400 },
    );
  }

  const result = await checkDelivery(zip);

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
