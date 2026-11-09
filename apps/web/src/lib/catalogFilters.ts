import type { ProductQuery } from "@/lib/publicApi";

export const CATALOG_PAGE_SIZE = 24;

export type CatalogSort = "newest" | "price_asc" | "price_desc" | "name";

export const SORT_OPTIONS: ReadonlyArray<{
  value: CatalogSort;
  label: string;
}> = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "name", label: "Name" },
];

export type SearchParamValue = string | string[] | undefined;
export type SearchParamsRecord = Record<string, SearchParamValue>;

export type CatalogFilters = {
  minPrice: string;
  maxPrice: string;
  material: string;
  color: string;
  inStock: boolean;
  sort: CatalogSort;
  page: number;
};

const SORT_VALUES = new Set<string>(SORT_OPTIONS.map((option) => option.value));

export function firstParam(value: SearchParamValue): string {
  if (Array.isArray(value)) {
    const first = value.find(
      (item) => typeof item === "string" && item.trim() !== "",
    );

    return first ? first.trim() : "";
  }

  return typeof value === "string" ? value.trim() : "";
}

function normalizePrice(value: SearchParamValue): string {
  const raw = firstParam(value);

  if (!raw) {
    return "";
  }

  const parsed = Number(raw.replace(/[$,]/g, ""));

  if (!Number.isFinite(parsed) || parsed < 0) {
    return "";
  }

  return String(parsed);
}

function normalizeText(value: SearchParamValue, maxLength = 200): string {
  return firstParam(value).slice(0, maxLength);
}

export function parseCatalogFilters(
  params: SearchParamsRecord,
): CatalogFilters {
  const sortRaw = firstParam(params.sort);
  const sort = SORT_VALUES.has(sortRaw)
    ? (sortRaw as CatalogSort)
    : "newest";

  const pageRaw = Number.parseInt(firstParam(params.page), 10);
  const page =
    Number.isFinite(pageRaw) && pageRaw > 0 ? Math.min(pageRaw, 100000) : 1;

  const inStockRaw = firstParam(params.in_stock).toLowerCase();

  return {
    minPrice: normalizePrice(params.min_price),
    maxPrice: normalizePrice(params.max_price),
    material: normalizeText(params.material),
    color: normalizeText(params.color),
    inStock: inStockRaw === "true" || inStockRaw === "1",
    sort,
    page,
  };
}

export function activeFilterCount(filters: CatalogFilters): number {
  let count = 0;

  if (filters.minPrice) count += 1;
  if (filters.maxPrice) count += 1;
  if (filters.material) count += 1;
  if (filters.color) count += 1;
  if (filters.inStock) count += 1;

  return count;
}

export function clearedFilters(filters: CatalogFilters): CatalogFilters {
  return {
    ...filters,
    minPrice: "",
    maxPrice: "",
    material: "",
    color: "",
    inStock: false,
    page: 1,
  };
}

export function catalogHref(
  pathname: string,
  options: {
    q?: string;
    filters: CatalogFilters;
    page?: number;
  },
): string {
  const { filters } = options;
  const search = new URLSearchParams();

  if (options.q) {
    search.set("q", options.q);
  }

  if (filters.minPrice) search.set("min_price", filters.minPrice);
  if (filters.maxPrice) search.set("max_price", filters.maxPrice);
  if (filters.material) search.set("material", filters.material);
  if (filters.color) search.set("color", filters.color);
  if (filters.inStock) search.set("in_stock", "true");
  if (filters.sort !== "newest") search.set("sort", filters.sort);

  const page = options.page ?? filters.page;
  if (page > 1) search.set("page", String(page));

  const query = search.toString();

  return query ? `${pathname}?${query}` : pathname;
}

export function buildProductQuery(
  filters: CatalogFilters,
  options: { categorySlug?: string; q?: string } = {},
): ProductQuery {
  const minPrice = filters.minPrice ? Number(filters.minPrice) : null;
  const maxPrice = filters.maxPrice ? Number(filters.maxPrice) : null;

  return {
    ...(options.categorySlug ? { categorySlug: options.categorySlug } : {}),
    ...(options.q ? { q: options.q } : {}),
    ...(minPrice !== null && Number.isFinite(minPrice) ? { minPrice } : {}),
    ...(maxPrice !== null && Number.isFinite(maxPrice) ? { maxPrice } : {}),
    ...(filters.inStock ? { inStock: true } : {}),
    ...(filters.material ? { material: filters.material } : {}),
    ...(filters.color ? { color: filters.color } : {}),
    sort: filters.sort,
    page: filters.page,
    pageSize: CATALOG_PAGE_SIZE,
  };
}

export function pieceCountLabel(count: number): string {
  return `${count} ${count === 1 ? "piece" : "pieces"}`;
}
