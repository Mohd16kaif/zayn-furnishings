import type { OrderStatus } from "@zayn/shared";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type AdminRole = "owner" | "staff";

export type AdminMe = {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
};

export type AdminStoreSettings = {
  store_name: string;
  phone: string;
  email: string;
  free_delivery_threshold_cents: number | null;
  show_financing: boolean;
};

export type AdminDeliveryZone = {
  id: string;
  name: string;
  zip_start: string;
  zip_end: string;
  fee_cents: number;
  free_over_cents: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AdminDeliveryCoverage = {
  ranges: Array<{ zip_start: string; zip_end: string }>;
};

export type AdminCategory = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  image_url: string | null;
  image_storage_path: string | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  seo_title: string | null;
  seo_description: string | null;
  product_count: number;
};

export type AdminContentType =
  | "announcement"
  | "hero"
  | "promo_card"
  | "room_tile"
  | "info_card"
  | "faq";

export type AdminContentBlock = {
  id: string;
  type: AdminContentType;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  image_url: string | null;
  storage_path: string | null;
  button_text: string | null;
  link_url: string | null;
  sort_order: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AdminProductImage = {
  id: string;
  product_id: string;
  url: string;
  storage_path: string | null;
  alt_text: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
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
  images: AdminProductImage[];
  primary_image_url: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductListResponse = {
  items: AdminProduct[];
  total: number;
  page: number;
  page_size: number;
};

export type AdminOrderStatus = OrderStatus;

export type AdminOrderListItem = {
  order_number: string;
  status: AdminOrderStatus;
  total_cents: number;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  item_count: number;
  delivery_status: string | null;
  has_stock_shortage: boolean;
};

export type AdminOrderListResponse = {
  items: AdminOrderListItem[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
    has_more: boolean;
  };
  counts_by_status: Record<AdminOrderStatus, number>;
};

export type AdminOrderItem = {
  name: string;
  sku: string | null;
  image_url: string | null;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
};

export type AdminOrderPayment = {
  provider: string;
  status: string;
  amount_cents: number;
  created_at: string;
};

export type AdminOrderDelivery = {
  status: string;
  method: string | null;
  partner_name: string | null;
  scheduled_date: string | null;
  time_window: string | null;
  tracking_number: string | null;
  carrier: string | null;
  driver_notes: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminOrderActivity = {
  action: string;
  admin_email: string | null;
  created_at: string;
  details: unknown;
};

export type AdminOrderDetail = {
  order_number: string;
  status: AdminOrderStatus;
  created_at: string;
  updated_at: string;
  subtotal_cents: number;
  discount_cents: number;
  delivery_fee_cents: number;
  tax_cents: number;
  total_cents: number;
  discount_code: string | null;
  customer: {
    name: string | null;
    phone: string | null;
    receipt_email: string;
    sms_opt_in: boolean;
  };
  shipping_address: {
    name: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    phone: string | null;
  };
  items: AdminOrderItem[];
  payments: AdminOrderPayment[];
  stripe_payment_intent_id: string | null;
  delivery: AdminOrderDelivery | null;
  notes: string | null;
  has_stock_shortage: boolean;
  activity: AdminOrderActivity[];
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

export async function adminUpload<T>(
  path: string,
  formData: FormData,
  onProgress?: (percent: number) => void,
): Promise<T> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    await handleUnauthorized();
    throw new AdminApiError(401, "Your session has expired.");
  }

  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.open("POST", `${apiUrl}${path}`);
    request.setRequestHeader(
      "Authorization",
      `Bearer ${session.access_token}`,
    );

    request.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    request.onload = () => {
      let data:
        | { error?: string; fields?: Record<string, string> }
        | null = null;

      try {
        data = request.responseText
          ? (JSON.parse(request.responseText) as {
              error?: string;
              fields?: Record<string, string>;
            })
          : null;
      } catch {
        data = null;
      }

      if (request.status === 401) {
        void handleUnauthorized();
        reject(new AdminApiError(401, "Your session has expired."));
        return;
      }

      if (request.status < 200 || request.status >= 300) {
        reject(
          new AdminApiError(
            request.status,
            data?.error ?? "Something went wrong. Please try again.",
            data?.fields,
          ),
        );
        return;
      }

      resolve(data as T);
    };

    request.onerror = () => {
      reject(
        new AdminApiError(
          0,
          "Unable to reach the server. Please check your connection and try again.",
        ),
      );
    };

    request.onabort = () => {
      reject(new AdminApiError(0, "The upload was cancelled."));
    };

    request.send(formData);
  });
}
