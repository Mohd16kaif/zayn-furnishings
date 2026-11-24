import { NextResponse } from "next/server";
import {
  buildAdminProxyRequestHeaders,
  createLimitedBodyStream,
  declaredBodyTooLarge,
  validateAdminProxyPath,
} from "@/lib/adminProxy";
import { getAdminSessionToken } from "@/lib/adminSession";
import { apiBaseUrl } from "@/lib/apiBaseUrl";
import { requestHeaders } from "@/lib/publicApi";
import {
  getVisitorIp,
  isSameOriginRequest,
} from "@/lib/requestGuards";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const ALLOWED_METHODS = new Set([
  "GET",
  "POST",
  "PATCH",
  "PUT",
  "DELETE",
]);

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: message },
    { status, headers: NO_STORE_HEADERS },
  );
}

async function handle(
  request: Request,
  context: RouteContext,
  method: string,
): Promise<NextResponse> {
  if (!ALLOWED_METHODS.has(method)) {
    return jsonError("Method not allowed.", 405);
  }

  const { path } = await context.params;
  const requestUrl = new URL(request.url);
  const validation = validateAdminProxyPath(
    path ?? [],
    requestUrl.pathname,
  );

  if (!validation.ok) {
    return jsonError("Not found.", 404);
  }

  if (
    MUTATING_METHODS.has(method) &&
    !isSameOriginRequest(request)
  ) {
    return jsonError("Forbidden", 403);
  }

  const sessionToken = await getAdminSessionToken();

  if (!sessionToken) {
    return jsonError("Unauthorized", 401);
  }

  if (declaredBodyTooLarge(request)) {
    return jsonError("Request body must be 45 MB or less.", 413);
  }

  const visitorIp = getVisitorIp(request);
  const storefrontHeaders = requestHeaders(visitorIp);
  const headers = buildAdminProxyRequestHeaders({
    contentType: request.headers.get("content-type"),
    sessionToken,
    storefrontKey: storefrontHeaders["x-storefront-key"] ?? null,
    visitorIp,
  });

  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
    cache: "no-store",
    redirect: "manual",
  };

  let bodyTooLarge = false;

  if (method !== "GET" && request.body) {
    init.body = createLimitedBodyStream(request.body, () => {
      bodyTooLarge = true;
    });
    init.duplex = "half";
  }

  try {
    const response = await fetch(
      `${apiBaseUrl().replace(/\/+$/, "")}/${validation.segments.join("/")}${requestUrl.search}`,
      init,
    );
    const responseHeaders = new Headers({
      "Cache-Control": "no-store",
    });
    const contentType = response.headers.get("content-type");

    if (contentType) {
      responseHeaders.set("Content-Type", contentType);
    }

    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    if (bodyTooLarge) {
      return jsonError("Request body must be 45 MB or less.", 413);
    }

    return jsonError("Admin API is temporarily unavailable.", 502);
  }
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  return handle(request, context, "GET");
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  return handle(request, context, "POST");
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  return handle(request, context, "PATCH");
}

export async function PUT(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  return handle(request, context, "PUT");
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  return handle(request, context, "DELETE");
}
