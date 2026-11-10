// Types for the public read-only API (apps/api /api/public routes).
// Shared between the API and the web app so both stay in sync.

export interface PublicCategoryNode {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  description: string | null;
  product_count: number;
  children: PublicCategoryNode[];
}

export interface PublicStoreSettings {
  store_name: string;
  phone: string;
  email: string;
  free_delivery_threshold_cents: number | null;
  show_financing: boolean;
}

export interface PublicContentBlock {
  id: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  image_url: string | null;
  button_text: string | null;
  link_url: string | null;
  sort_order: number;
}

export type PublicHomeContent = Record<string, PublicContentBlock[]>;

export interface PublicProductCard {
  id: string;
  name: string;
  slug: string;
  price_cents: number;
  sale_price_cents: number | null;
  in_stock: boolean;
  primary_image_url: string | null;
  category_name: string | null;
  category_slug: string | null;
  material: string | null;
  color: string | null;
}

export interface PublicProductFacets {
  min_price: number | null;
  max_price: number | null;
  materials: string[];
  colors: string[];
}

export interface PublicProductList {
  items: PublicProductCard[];
  total: number;
  page: number;
  page_size: number;
  facets: PublicProductFacets;
}

export interface PublicProductImage {
  id: string;
  url: string;
  alt_text: string | null;
  sort_order: number;
}

export interface PublicProductDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number;
  sale_price_cents: number | null;
  in_stock: boolean;
  material: string | null;
  color: string | null;
  dimensions: {
    width_in: number | null;
    depth_in: number | null;
    height_in: number | null;
    weight_lb: number | null;
  };
  images: PublicProductImage[];
  category: { name: string; slug: string } | null;
  breadcrumb: Array<{ name: string; slug: string }>;
  seo_title: string | null;
  seo_description: string | null;
  related_products: PublicProductCard[];
}

export interface PublicDeliveryZone {
  name: string;
  zip_start: string;
  zip_end: string;
  fee_cents: number;
  free_over_cents: number | null;
}

export interface PublicDeliveryCheck {
  available: boolean;
  zone: PublicDeliveryZone | null;
  subtotal_cents: number;
  fee_cents: number | null;
  is_free: boolean;
  free_over_cents: number | null;
  amount_to_free_cents: number | null;
}
