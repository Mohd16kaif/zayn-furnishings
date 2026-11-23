import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE_NAME } from "@/lib/adminSessionOptions";
import { IS_STAGING } from "@/lib/appEnv";
import { readStoreOpen } from "@/lib/storeStatus";

const CATEGORY_CACHE_TTL_MS = 60_000;
const PRODUCT_CACHE_TTL_MS = 60_000;
const MAX_PRODUCT_CACHE_ENTRIES = 500;
// Short timeout on purpose: this runs on every page request.
const API_TIMEOUT_MS = 2_500;

let categorySlugCache: { slugs: Set<string>; expiresAt: number } | null = null;

const productExistenceCache = new Map<
  string,
  { exists: boolean; expiresAt: number }
>();

function publicApiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  return `${base}/api/public${path}`;
}

function storefrontHeaders(): Record<string, string> {
  const key = process.env.STOREFRONT_API_KEY;

  return key ? { "x-storefront-key": key } : {};
}

function collectCategorySlugs(nodes: unknown, slugs: Set<string>): void {
  if (!Array.isArray(nodes)) {
    return;
  }

  for (const node of nodes) {
    if (typeof node !== "object" || node === null) {
      continue;
    }

    const record = node as { slug?: unknown; children?: unknown };

    if (typeof record.slug === "string") {
      slugs.add(record.slug);
    }

    collectCategorySlugs(record.children, slugs);
  }
}

async function getCategorySlugs(): Promise<Set<string> | null> {
  const now = Date.now();

  if (categorySlugCache && categorySlugCache.expiresAt > now) {
    return categorySlugCache.slugs;
  }

  try {
    const response = await fetch(publicApiUrl("/categories"), {
      headers: storefrontHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok) {
      return categorySlugCache?.slugs ?? null;
    }

    const data: unknown = await response.json();
    const slugs = new Set<string>();
    collectCategorySlugs(data, slugs);
    categorySlugCache = { slugs, expiresAt: now + CATEGORY_CACHE_TTL_MS };

    return slugs;
  } catch {
    return categorySlugCache?.slugs ?? null;
  }
}

async function handleCategoryRequest(
  request: NextRequest,
): Promise<NextResponse> {
  let slug: string;

  try {
    slug = decodeURIComponent(request.nextUrl.pathname.slice(3)).replace(
      /\/+$/,
      "",
    );
  } catch {
    return NextResponse.next();
  }

  if (!slug || slug.includes("/")) {
    return NextResponse.next();
  }

  const slugs = await getCategorySlugs();

  if (slugs && !slugs.has(slug)) {
    return NextResponse.rewrite(new URL("/404", request.url), {
      status: 404,
    });
  }

  return NextResponse.next();
}

function pruneProductCache(now: number): void {
  if (productExistenceCache.size < MAX_PRODUCT_CACHE_ENTRIES) {
    return;
  }

  for (const [slug, entry] of productExistenceCache) {
    if (entry.expiresAt <= now) {
      productExistenceCache.delete(slug);
    }
  }

  if (productExistenceCache.size >= MAX_PRODUCT_CACHE_ENTRIES) {
    productExistenceCache.clear();
  }
}

async function productExists(slug: string): Promise<boolean | null> {
  const now = Date.now();
  const cached = productExistenceCache.get(slug);

  if (cached && cached.expiresAt > now) {
    return cached.exists;
  }

  try {
    const response = await fetch(
      publicApiUrl(`/products/${encodeURIComponent(slug)}`),
      {
        headers: storefrontHeaders(),
        cache: "no-store",
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      },
    );

    if (response.status === 404) {
      productExistenceCache.set(slug, {
        exists: false,
        expiresAt: now + PRODUCT_CACHE_TTL_MS,
      });
      pruneProductCache(now);
      return false;
    }

    if (!response.ok) {
      return cached?.exists ?? null;
    }

    await response.text().catch(() => "");
    productExistenceCache.set(slug, {
      exists: true,
      expiresAt: now + PRODUCT_CACHE_TTL_MS,
    });
    pruneProductCache(now);

    return true;
  } catch {
    return cached?.exists ?? null;
  }
}

async function handleProductRequest(
  request: NextRequest,
): Promise<NextResponse> {
  let slug: string;

  try {
    slug = decodeURIComponent(request.nextUrl.pathname.slice(3)).replace(
      /\/+$/,
      "",
    );
  } catch {
    return NextResponse.next();
  }

  if (!slug || slug.includes("/")) {
    return NextResponse.next();
  }

  const exists = await productExists(slug);

  if (exists === false) {
    return NextResponse.rewrite(new URL("/404", request.url), {
      status: 404,
    });
  }

  return NextResponse.next();
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isAdminPath =
    pathname === "/admin" || pathname.startsWith("/admin/");

  if (!isAdminPath) {
    const storeOpen = await readStoreOpen();
    const closed = !storeOpen;
    let response: NextResponse;

    if (closed) {
      response = NextResponse.next();
    } else if (pathname.startsWith("/c/")) {
      response = await handleCategoryRequest(request);
    } else if (pathname.startsWith("/p/")) {
      response = await handleProductRequest(request);
    } else {
      response = NextResponse.next();
    }

    if (IS_STAGING || closed) {
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
    }

    return response;
  }

  const isLoginPage = pathname === "/admin/login";

  if (isLoginPage) {
    return NextResponse.next();
  }

  const hasAdminSession = Boolean(
    request.cookies.get(ADMIN_SESSION_COOKIE_NAME)?.value,
  );

  if (!hasAdminSession) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin",
    "/admin/:path*",
    "/((?!api|_next/static|_next/image|admin|design-preview|.*\\..*).*)",
  ],
};
