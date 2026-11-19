import { connection } from "next/server";

// Apple Pay domain verification file. This route lives outside the (store)
// route group so it works even while the storefront shows "Coming soon".
// APPLE_PAY_DOMAIN_ASSOCIATION is server-only and must never be NEXT_PUBLIC_.
export async function GET(): Promise<Response> {
  await connection();

  const association = process.env.APPLE_PAY_DOMAIN_ASSOCIATION;

  if (!association || association.trim() === "") {
    return new Response("Not found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(association, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
