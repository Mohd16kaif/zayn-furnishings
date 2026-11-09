"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import type { PublicProductFacets } from "@zayn/shared";
import { CloseIcon } from "@/components/design/icons";
import {
  SORT_OPTIONS,
  activeFilterCount,
  catalogHref,
  clearedFilters,
  type CatalogFilters,
} from "@/lib/catalogFilters";

type CatalogFilterPanelProps = {
  action: string;
  filters: CatalogFilters;
  facets: PublicProductFacets;
  q?: string;
  showMaterialColor?: boolean;
};

type FilterFieldsProps = CatalogFilterPanelProps & {
  idPrefix: string;
};

function pricePlaceholder(value: number | null): string | undefined {
  if (value === null || !Number.isFinite(value)) {
    return undefined;
  }

  return String(Number(value.toFixed(2)));
}

function keepSingleChoice(event: ChangeEvent<HTMLInputElement>) {
  const input = event.currentTarget;

  if (!input.checked || !input.form) {
    return;
  }

  const group = input.form.querySelectorAll<HTMLInputElement>(
    `input[name="${input.name}"]`,
  );

  group.forEach((sibling) => {
    if (sibling !== input) {
      sibling.checked = false;
    }
  });
}

function FilterFields({
  action,
  filters,
  facets,
  q,
  showMaterialColor = false,
  idPrefix,
}: FilterFieldsProps) {
  const materials = showMaterialColor ? facets.materials : [];
  const colors = showMaterialColor ? facets.colors : [];
  const clearHref = catalogHref(action, {
    q,
    filters: clearedFilters(filters),
  });

  return (
    <form method="get" action={action} className="zf-filter-form">
      {q ? <input type="hidden" name="q" value={q} /> : null}

      <fieldset className="zf-filter-group">
        <legend className="zf-filter-group__title">Price</legend>
        <div className="zf-filter-price">
          <label className="zf-filter-price__field" htmlFor={`${idPrefix}-min`}>
            <span>Min ($)</span>
            <input
              id={`${idPrefix}-min`}
              type="number"
              name="min_price"
              inputMode="decimal"
              min="0"
              step="1"
              placeholder={pricePlaceholder(facets.min_price)}
              defaultValue={filters.minPrice}
              aria-label="Minimum price in dollars"
            />
          </label>
          <span className="zf-filter-price__dash" aria-hidden="true">
            –
          </span>
          <label className="zf-filter-price__field" htmlFor={`${idPrefix}-max`}>
            <span>Max ($)</span>
            <input
              id={`${idPrefix}-max`}
              type="number"
              name="max_price"
              inputMode="decimal"
              min="0"
              step="1"
              placeholder={pricePlaceholder(facets.max_price)}
              defaultValue={filters.maxPrice}
              aria-label="Maximum price in dollars"
            />
          </label>
        </div>
      </fieldset>

      {materials.length > 0 ? (
        <fieldset className="zf-filter-group">
          <legend className="zf-filter-group__title">Material</legend>
          {materials.map((material) => (
            <label className="zf-filter-check" key={material}>
              <input
                type="checkbox"
                name="material"
                value={material}
                defaultChecked={filters.material === material}
                onChange={keepSingleChoice}
              />
              <span>{material}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {colors.length > 0 ? (
        <fieldset className="zf-filter-group">
          <legend className="zf-filter-group__title">Color</legend>
          {colors.map((color) => (
            <label className="zf-filter-check" key={color}>
              <input
                type="checkbox"
                name="color"
                value={color}
                defaultChecked={filters.color === color}
                onChange={keepSingleChoice}
              />
              <span>{color}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <fieldset className="zf-filter-group">
        <legend className="zf-filter-group__title">Availability</legend>
        <label className="zf-filter-check">
          <input
            type="checkbox"
            name="in_stock"
            value="true"
            defaultChecked={filters.inStock}
          />
          <span>In stock only</span>
        </label>
      </fieldset>

      <fieldset className="zf-filter-group">
        <legend className="zf-filter-group__title">Sort by</legend>
        <label className="zf-filter-select" htmlFor={`${idPrefix}-sort`}>
          <span className="zf-sr-only">Sort products</span>
          <select
            id={`${idPrefix}-sort`}
            name="sort"
            defaultValue={filters.sort}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <button type="submit" className="zf-btn zf-btn--primary zf-filter-apply">
        Apply filters
      </button>
      <Link className="zf-filter-clear" href={clearHref}>
        Clear all
      </Link>
    </form>
  );
}

export function CatalogFilterPanel({
  action,
  filters,
  facets,
  q,
  showMaterialColor = false,
}: CatalogFilterPanelProps) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeCount = activeFilterCount(filters);

  useEffect(() => {
    if (!open) {
      return;
    }

    const panel = panelRef.current;
    const trigger = toggleRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    function focusable(): HTMLElement[] {
      if (!panel) {
        return [];
      }

      return Array.from(
        panel.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => element.offsetParent !== null);
    }

    const frame = requestAnimationFrame(() => focusable()[0]?.focus());

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const items = focusable();

      if (items.length === 0) {
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open]);

  const fields = (
    <>
      <FilterFields
        action={action}
        filters={filters}
        facets={facets}
        q={q}
        showMaterialColor={showMaterialColor}
        idPrefix="sidebar"
      />
    </>
  );

  return (
    <div className="zf-catalog__aside">
      <button
        ref={toggleRef}
        type="button"
        className="zf-filters-toggle"
        aria-expanded={open}
        aria-controls="zf-filter-drawer"
        onClick={() => setOpen(true)}
      >
        Filters
        {activeCount > 0 ? (
          <span
            className="zf-filters-toggle__count"
            aria-label={`${activeCount} active filter${activeCount === 1 ? "" : "s"}`}
          >
            {activeCount}
          </span>
        ) : null}
      </button>

      <aside className="zf-catalog__sidebar" aria-label="Filters">
        {fields}
      </aside>

      <noscript>
        <style>{`.zf-filters-toggle{display:none}.zf-catalog__sidebar{display:block}`}</style>
      </noscript>

      {open ? (
        <div className="zf-filter-drawer">
          <button
            type="button"
            className="zf-filter-drawer__scrim"
            aria-label="Close filters"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            id="zf-filter-drawer"
            className="zf-filter-drawer__panel"
            role="dialog"
            aria-modal="true"
            aria-label="Filters"
          >
            <div className="zf-filter-drawer__head">
              <span className="zf-filter-drawer__title">Filters</span>
              <button
                type="button"
                className="zf-icon-btn"
                aria-label="Close filters"
                onClick={() => setOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>
            <FilterFields
              action={action}
              filters={filters}
              facets={facets}
              q={q}
              showMaterialColor={showMaterialColor}
              idPrefix="drawer"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
