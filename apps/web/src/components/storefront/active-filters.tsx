import Link from "next/link";
import {
  catalogHref,
  clearedFilters,
  type CatalogFilters,
} from "@/lib/catalogFilters";

type ActiveFiltersProps = {
  pathname: string;
  q?: string;
  filters: CatalogFilters;
  showMaterialColor?: boolean;
};

type ActiveChip = {
  key: string;
  label: string;
  href: string;
};

export function ActiveFilters({
  pathname,
  q,
  filters,
  showMaterialColor = false,
}: ActiveFiltersProps) {
  const base = { ...filters, page: 1 };
  const chips: ActiveChip[] = [];

  if (filters.minPrice) {
    chips.push({
      key: "min_price",
      label: `Min $${filters.minPrice}`,
      href: catalogHref(pathname, {
        q,
        filters: { ...base, minPrice: "" },
      }),
    });
  }

  if (filters.maxPrice) {
    chips.push({
      key: "max_price",
      label: `Max $${filters.maxPrice}`,
      href: catalogHref(pathname, {
        q,
        filters: { ...base, maxPrice: "" },
      }),
    });
  }

  if (filters.inStock) {
    chips.push({
      key: "in_stock",
      label: "In stock",
      href: catalogHref(pathname, {
        q,
        filters: { ...base, inStock: false },
      }),
    });
  }

  if (showMaterialColor && filters.material) {
    chips.push({
      key: "material",
      label: filters.material,
      href: catalogHref(pathname, {
        q,
        filters: { ...base, material: "" },
      }),
    });
  }

  if (showMaterialColor && filters.color) {
    chips.push({
      key: "color",
      label: filters.color,
      href: catalogHref(pathname, {
        q,
        filters: { ...base, color: "" },
      }),
    });
  }

  if (chips.length === 0) {
    return null;
  }

  const clearHref = catalogHref(pathname, {
    q,
    filters: clearedFilters(filters),
  });

  return (
    <div className="zf-active-filters">
      <span className="zf-active-filters__label">Active filters</span>
      <ul className="zf-active-filters__list">
        {chips.map((chip) => (
          <li key={chip.key}>
            <Link
              className="zf-chip"
              href={chip.href}
              aria-label={`Remove ${chip.label} filter`}
            >
              {chip.label}
              <span aria-hidden="true">×</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link className="zf-active-filters__clear" href={clearHref}>
        Clear all
      </Link>
    </div>
  );
}
