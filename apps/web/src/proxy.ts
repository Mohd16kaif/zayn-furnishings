import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const CATEGORY_CACHE_TTL_MS = 60_000;
const PRODUCT_CACHE_TTL_MS = 60_000;
const MAX_PRODUCT_CACHE_ENTRIES = 500;

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(publicApiUrl("/categories"), {
      headers: storefrontHeaders(),
      cache: "no-store",
      signal: controller.signal,
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
  } finally {
    clearTimeout(timeout);
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(
      publicApiUrl(`/products/${encodeURIComponent(slug)}`),
      {
        headers: storefrontHeaders(),
        cache: "no-store",
        signal: controller.signal,
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
  } finally {
    clearTimeout(timeout);
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

  if (pathname.startsWith("/c/")) {
    return handleCategoryRequest(request);
  }

  if (pathname.startsWith("/p/")) {
    return handleProductRequest(request);
  }

  const isLoginPage = pathname === "/admin/login";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    if (isLoginPage) {
      return NextResponse.next();
    }

    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!isLoginPage && !session?.user) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/c/:slug", "/p/:slug"],
};
