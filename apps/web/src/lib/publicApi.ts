import type {
  PublicCategoryNode,
  PublicDeliveryCheck,
  PublicHomeContent,
  PublicProductCard,
  PublicProductDetail,
  PublicProductList,
  PublicStoreSettings,
} from "@zayn/shared";

/**
 * Server-side data layer for the public API.
 *
 * Every helper:
 * - fetches GET <NEXT_PUBLIC_API_URL>/api/public/... with `revalidate: 60`
 * - sends `x-storefront-key` (from the non-public STOREFRONT_API_KEY secret)
 *   so the storefront skips the per-IP rate limit
 * - NEVER throws: a down API returns a typed safe fallback so a page can
 *   render an empty menu / friendly notice instead of failing.
 */

const DEFAULT_API_URL = "http://localhost:4000";
const REVALIDATE_SECONDS = 60;

export const DEFAULT_STORE_SETTINGS: PublicStoreSettings = {
  store_name: "Zayn Furnishings",
  phone: "",
  email: "",
  free_delivery_threshold_cents: 199900,
  show_financing: false,
};

const EMPTY_PRODUCT_LIST: PublicProductList = {
  items: [],
  total: 0,
  page: 1,
  page_size: 24,
  facets: { min_price: null, max_price: null, materials: [], colors: [] },
};

const EMPTY_PRODUCT_DETAIL: PublicProductDetail = {
  id: "",
  name: "",
  slug: "",
  description: null,
  price_cents: 0,
  sale_price_cents: null,
  in_stock: false,
  material: null,
  color: null,
  dimensions: {
    width_in: null,
    depth_in: null,
    height_in: null,
    weight_lb: null,
  },
  images: [],
  category: null,
  breadcrumb: [],
  seo_title: null,
  seo_description: null,
  related_products: [],
};

const EMPTY_DELIVERY_CHECK: PublicDeliveryCheck = {
  available: false,
  fee_cents: null,
  free_over_cents: null,
};

const EMPTY_CART_VALIDATION: CartValidation = {
  items: [],
  unavailable: [],
  subtotal_cents: 0,
  free_delivery_threshold_cents:
    DEFAULT_STORE_SETTINGS.free_delivery_threshold_cents,
};

export type CartValidateItem = {
  product_id: string;
  quantity: number;
};

export type CartValidatedItem = {
  id: string;
  slug: string;
  name: string;
  price_cents: number;
  sale_price_cents: number | null;
  effective_price_cents: number;
  primary_image_url: string | null;
  in_stock: boolean;
  available: boolean;
};

export type CartValidation = {
  items: CartValidatedItem[];
  unavailable: string[];
  subtotal_cents: number;
  free_delivery_threshold_cents: number;
};

export type ApiResult<T> = {
  ok: boolean;
  data: T;
  error?: string;
};

function apiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;
}

function requestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const key = process.env.STOREFRONT_API_KEY;

  if (key) {
    headers["x-storefront-key"] = key;
  }

  return headers;
}

function isValidSettings(value: unknown): value is PublicStoreSettings {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.store_name === "string" &&
    typeof candidate.phone === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.free_delivery_threshold_cents === "number" &&
    typeof candidate.show_financing === "boolean"
  );
}

async function safeGet<T>(
  path: string,
  fallback: T,
  validate: (value: unknown) => boolean,
  revalidateSeconds = REVALIDATE_SECONDS,
): Promise<ApiResult<T>> {
  const url = `${apiUrl()}/api/public${path}`;

  try {
    const response = await fetch(url, {
      headers: requestHeaders(),
      next: { revalidate: revalidateSeconds },
    });

    if (!response.ok) {
      return { ok: false, data: fallback, error: `HTTP ${response.status}` };
    }

    const parsed: unknown = await response.json();

    if (!validate(parsed)) {
      return { ok: false, data: fallback, error: "Unexpected response shape" };
    }

    return { ok: true, data: parsed as T };
  } catch (error) {
    return {
      ok: false,
      data: fallback,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

function isCategoryNodeArray(value: unknown): value is PublicCategoryNode[] {
  return Array.isArray(value);
}

function isSettings(value: unknown): value is PublicStoreSettings {
  return isValidSettings(value);
}

function isHomeContent(value: unknown): value is PublicHomeContent {
  return typeof value === "object" && value !== null;
}

function isProductList(value: unknown): value is PublicProductList {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    Array.isArray(candidate.items) &&
    typeof candidate.total === "number" &&
    typeof candidate.page === "number" &&
    typeof candidate.page_size === "number" &&
    typeof candidate.facets === "object" &&
    candidate.facets !== null
  );
}

function isProductDetail(value: unknown): value is PublicProductDetail {
  return typeof value === "object" && value !== null && value !== undefined;
}

function isCartValidation(value: unknown): value is CartValidation {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    Array.isArray(candidate.items) &&
    Array.isArray(candidate.unavailable) &&
    typeof candidate.subtotal_cents === "number" &&
    typeof candidate.free_delivery_threshold_cents === "number"
  );
}

export function getCategories(): Promise<ApiResult<PublicCategoryNode[]>> {
  return safeGet("/categories", [], isCategoryNodeArray);
}

export function getSettings(): Promise<ApiResult<PublicStoreSettings>> {
  return safeGet("/settings", DEFAULT_STORE_SETTINGS, isSettings);
}

export function getContentHome(): Promise<ApiResult<PublicHomeContent>> {
  return safeGet("/content/home", {}, isHomeContent);
}

export type ProductQuery = {
  categorySlug?: string;
  q?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  material?: string;
  color?: string;
  sort?: "newest" | "price_asc" | "price_desc" | "name";
  featured?: boolean;
  page?: number;
  pageSize?: number;
};

export function getProducts(
  query: ProductQuery = {},
): Promise<ApiResult<PublicProductList>> {
  const search = new URLSearchParams();

  if (query.categorySlug) {
    search.set("category", query.categorySlug);
  }
  if (query.q) {
    search.set("q", query.q);
  }
  if (query.minPrice !== undefined) {
    search.set("min_price", String(query.minPrice));
  }
  if (query.maxPrice !== undefined) {
    search.set("max_price", String(query.maxPrice));
  }
  if (query.inStock !== undefined) {
    search.set("in_stock", String(query.inStock));
  }
  if (query.material) {
    search.set("material", query.material);
  }
  if (query.color) {
    search.set("color", query.color);
  }
  if (query.sort) {
    search.set("sort", query.sort);
  }
  if (query.featured !== undefined) {
    search.set("featured", String(query.featured));
  }
  if (query.page !== undefined) {
    search.set("page", String(query.page));
  }
  if (query.pageSize !== undefined) {
    search.set("page_size", String(query.pageSize));
  }

  const suffix = search.size > 0 ? `?${search.toString()}` : "";

  return safeGet(`/products${suffix}`, EMPTY_PRODUCT_LIST, isProductList);
}

export function getProduct(
  slug: string,
): Promise<ApiResult<PublicProductDetail>> {
  return safeGet(`/products/${encodeURIComponent(slug)}`, EMPTY_PRODUCT_DETAIL, isProductDetail);
}

/** Live cart validation (no caching) — prices must always come from the API. */
export async function validateCart(
  items: CartValidateItem[],
): Promise<ApiResult<CartValidation>> {
  const url = `${apiUrl()}/api/public/cart/validate`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...requestHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items }),
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        ok: false,
        data: EMPTY_CART_VALIDATION,
        error: `HTTP ${response.status}`,
      };
    }

    const parsed: unknown = await response.json();

    if (!isCartValidation(parsed)) {
      return {
        ok: false,
        data: EMPTY_CART_VALIDATION,
        error: "Unexpected response shape",
      };
    }

    return { ok: true, data: parsed };
  } catch (error) {
    return {
      ok: false,
      data: EMPTY_CART_VALIDATION,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

/** Live check (no caching) — used by the /api/zip-check route handler. */
export async function checkDelivery(
  zip: string,
): Promise<ApiResult<PublicDeliveryCheck>> {
  const url = `${apiUrl()}/api/public/delivery/check?zip=${encodeURIComponent(zip)}`;

  try {
    const response = await fetch(url, {
      headers: requestHeaders(),
      cache: "no-store",
    });

    if (!response.ok) {
      return { ok: false, data: EMPTY_DELIVERY_CHECK, error: `HTTP ${response.status}` };
    }

    const parsed: unknown = await response.json();

    if (typeof parsed !== "object" || parsed === null) {
      return {
        ok: false,
        data: EMPTY_DELIVERY_CHECK,
        error: "Unexpected response shape",
      };
    }

    const value = parsed as Record<string, unknown>;

    return {
      ok: true,
      data: {
        available: value.available === true,
        fee_cents: typeof value.fee_cents === "number" ? value.fee_cents : null,
        free_over_cents:
          typeof value.free_over_cents === "number" ? value.free_over_cents : null,
      } satisfies PublicDeliveryCheck,
    };
  } catch (error) {
    return {
      ok: false,
      data: EMPTY_DELIVERY_CHECK,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

export type { PublicProductCard };
