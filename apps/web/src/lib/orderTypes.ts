export type CustomerOrderSummary = {
  order_number: string;
  created_at: string;
  total_cents: number;
  status: string;
};

export type CustomerOrderList = {
  orders: CustomerOrderSummary[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
};

export type CustomerOrderItem = {
  product_id: string | null;
  name: string;
  sku: string | null;
  image_url: string | null;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
};

export type CustomerOrderDetail = {
  order_number: string;
  status: string;
  created_at: string;
  subtotal_cents: number;
  discount_cents: number;
  delivery_fee_cents: number;
  tax_cents: number;
  total_cents: number;
  discount_code: string | null;
  address: {
    name: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  };
  delivery_status: string | null;
  delivery: {
    status: string;
    method: string | null;
    partner_name: string | null;
    scheduled_date: string | null;
    time_window: string | null;
    tracking_number: string | null;
    carrier: string | null;
  } | null;
  items: CustomerOrderItem[];
};

export const EMPTY_ORDER_LIST: CustomerOrderList = {
  orders: [],
  page: 1,
  page_size: 10,
  total: 0,
  has_more: false,
};

export function isCustomerOrderList(value: unknown): value is CustomerOrderList {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    Array.isArray(candidate.orders) &&
    typeof candidate.page === "number" &&
    typeof candidate.page_size === "number" &&
    typeof candidate.total === "number" &&
    typeof candidate.has_more === "boolean"
  );
}

export function isCustomerOrderDetail(
  value: unknown,
): value is CustomerOrderDetail {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.order_number === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.total_cents === "number" &&
    Array.isArray(candidate.items) &&
    typeof candidate.address === "object" &&
    candidate.address !== null
  );
}

export function formatOrderStatus(status: string): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatOrderDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
