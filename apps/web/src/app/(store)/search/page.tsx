import type { Metadata } from "next";
import Link from "next/link";
import { cacheLife, cacheTag } from "next/cache";
import {
  activeFilterCount,
  catalogHref,
  clearedFilters,
  buildProductQuery,
  firstParam,
  parseCatalogFilters,
} from "@/lib/catalogFilters";
import {
  getCategories,
  getProducts,
  PUBLIC_CATEGORIES_TAG,
  type ProductQuery,
} from "@/lib/publicApi";
import { ActiveFilters } from "@/components/storefront/active-filters";
import { CatalogFilterPanel } from "@/components/storefront/catalog-filters";
import { CatalogResults } from "@/components/storefront/catalog-results";
import { CategorySuggestions } from "@/components/storefront/category-suggestions";
import { EmptyState } from "@/components/storefront/empty-state";

export const instant = false;

export const metadata: Metadata = {
  title: "Search",
  description: "Search the Zayn Furnishings catalog.",
  robots: { index: false, follow: true },
};

type SearchPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

/**
 * Cache the catalog reads so instant-navigation validation does not see
 * runtime fetch internals as blocking time reads. The 60-second lifetime
 * matches the existing fetch revalidation.
 */
async function loadSearchData(query: ProductQuery | null) {
  "use cache";
  cacheLife("minutes");
  cacheTag(PUBLIC_CATEGORIES_TAG);

  return Promise.all([
    getCategories(),
    query ? getProducts(query) : Promise.resolve(null),
  ]);
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const rawSearch = await searchParams;
  const q = firstParam(rawSearch.q).slice(0, 200);
  const filters = parseCatalogFilters(rawSearch);
  const query = q ? buildProductQuery(filters, { q }) : null;

  const [categoriesResult, productsResult] = await loadSearchData(query);

  const categories = categoriesResult.data;
  const activeCount = activeFilterCount(filters);
  const clearHref = catalogHref("/search", {
    q,
    filters: clearedFilters(filters),
  });

  return (
    <section className="zf-catalog zf-search-page">
      <div className="zf-container">
        <header className="zf-catalog__header">
          <nav className="zf-breadcrumb" aria-label="Breadcrumb">
            <ol>
              <li>
                <Link href="/">Home</Link>
              </li>
              <li aria-current="page">Search</li>
            </ol>
          </nav>

          <h1 className="zf-catalog__title">
            {q ? <>Results for &quot;{q}&quot;</> : "Search"}
          </h1>
        </header>

        {!q ? (
          <EmptyState
            title="Browse the collection"
            body="Search by piece, room, material, or finish — or start with a collection below."
          >
            <CategorySuggestions categories={categories} />
          </EmptyState>
        ) : !productsResult || !productsResult.ok ? (
          <EmptyState
            title="We couldn't run that search."
            body="The catalog is taking a moment. Please try again shortly."
          >
            <Link
              className="zf-btn zf-btn--ghost"
              href={catalogHref("/search", { q, filters })}
            >
              Try again
            </Link>
            <CategorySuggestions categories={categories} heading="Browse instead" />
          </EmptyState>
        ) : productsResult.data.total === 0 ? (
          <EmptyState
            title={
              activeCount > 0
                ? "No pieces match those filters."
                : "No pieces match your search."
            }
            body="Try a different term or browse a collection below."
          >
            {activeCount > 0 ? (
              <Link className="zf-btn zf-btn--primary" href={clearHref}>
                Clear filters
              </Link>
            ) : null}
            <CategorySuggestions categories={categories} heading="Browse the collection" />
          </EmptyState>
        ) : (
          <>
            <ActiveFilters pathname="/search" q={q} filters={filters} />

            <div className="zf-catalog__layout">
              <CatalogFilterPanel
                action="/search"
                filters={filters}
                facets={productsResult.data.facets}
                q={q}
                showMaterialColor={false}
              />

              <div className="zf-catalog__results">
                <CatalogResults
                  products={productsResult.data.items}
                  total={productsResult.data.total}
                  page={productsResult.data.page}
                  pageSize={productsResult.data.page_size}
                  hrefForPage={(page) =>
                    catalogHref("/search", { q, filters, page })
                  }
                />
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
