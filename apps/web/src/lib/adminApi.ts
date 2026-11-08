import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type AdminCategory = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  image_url: string | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  seo_title: string | null;
  seo_description: string | null;
  product_count: number;
};

export type AdminProduct = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number;
  sale_price_cents: number | null;
  sku: string | null;
  stock_qty: number;
  low_stock_threshold: number;
  width_in: number | null;
  depth_in: number | null;
  height_in: number | null;
  weight_lb: number | null;
  material: string | null;
  color: string | null;
  status: "draft" | "active" | "archived";
  category_id: string | null;
  category_name: string | null;
  is_featured: boolean;
  seo_title: string | null;
  seo_description: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductListResponse = {
  items: AdminProduct[];
  total: number;
  page: number;
  page_size: number;
};

export class AdminApiError extends Error {
  status: number;
  fields?: Record<string, string>;

  constructor(
    status: number,
    message: string,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.fields = fields;
  }
}

type AdminFetchOptions = Omit<RequestInit, "body"> & {
  json?: unknown;
  body?: BodyInit | null;
};

async function handleUnauthorized(): Promise<void> {
  try {
    await getSupabaseBrowserClient().auth.signOut();
  } catch {
    // Ignore sign-out failures; the redirect still needs to happen.
  }

  if (typeof window !== "undefined") {
    window.location.replace("/admin/login?reason=unauthorized");
  }
}

export async function adminFetch<T>(
  path: string,
  options: AdminFetchOptions = {},
): Promise<T> {
  const { json, ...init } = options;
  const supabase = getSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    await handleUnauthorized();
    throw new AdminApiError(401, "Your session has expired.");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);

  let body = init.body;

  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }

  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers,
    body,
    cache: "no-store",
  });

  if (response.status === 401) {
    await handleUnauthorized();
    throw new AdminApiError(401, "Your session has expired.");
  }

  const data = (await response.json().catch(() => null)) as
    | { error?: string; fields?: Record<string, string> }
    | null;

  if (!response.ok) {
    throw new AdminApiError(
      response.status,
      data?.error ?? "Something went wrong. Please try again.",
      data?.fields,
    );
  }

  return data as T;
}
