import type { Metadata } from "next";
import Link from "next/link";
import {
  activeFilterCount,
  buildProductQuery,
  catalogHref,
  clearedFilters,
  parseCatalogFilters,
  pieceCountLabel,
} from "@/lib/catalogFilters";
import { getCategories, getProducts } from "@/lib/publicApi";
import { ActiveFilters } from "@/components/storefront/active-filters";
import { CatalogFilterPanel } from "@/components/storefront/catalog-filters";
import { CatalogResults } from "@/components/storefront/catalog-results";
import { CategorySuggestions } from "@/components/storefront/category-suggestions";
import { EmptyState } from "@/components/storefront/empty-state";

export const instant = false;

const description =
  "Discover the newest furniture and fresh arrivals at Zayn Furnishings.";

export const metadata: Metadata = {
  title: "New Arrivals",
  description,
  alternates: { canonical: "/new" },
  openGraph: {
    title: "New Arrivals",
    description,
    url: "/new",
    type: "website",
  },
};

type NewArrivalsPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function NewArrivalsPage({
  searchParams,
}: NewArrivalsPageProps) {
  const rawSearch = await searchParams;
  const filters = parseCatalogFilters(rawSearch);

  const [categoriesResult, productsResult] = await Promise.all([
    getCategories(),
    getProducts(buildProductQuery(filters)),
  ]);

  const categories = categoriesResult.data;
  const activeCount = activeFilterCount(filters);
  const productsDown = !productsResult.ok;
  const total = productsResult.data.total;
  const clearHref = catalogHref("/new", {
    filters: clearedFilters(filters),
  });

  return (
    <section className="zf-catalog">
      <div className="zf-container">
        <header className="zf-catalog__header">
          <nav className="zf-breadcrumb" aria-label="Breadcrumb">
            <ol>
              <li>
                <Link href="/">Home</Link>
              </li>
              <li aria-current="page">New Arrivals</li>
            </ol>
          </nav>

          <div className="zf-catalog__title-row">
            <h1 className="zf-catalog__title">New Arrivals</h1>
            {!productsDown && total > 0 ? (
              <p className="zf-catalog__count">{pieceCountLabel(total)}</p>
            ) : null}
          </div>

          <p className="zf-catalog__description">
            The latest additions to the Zayn collection, fresh from our
            workshops and ready for the rooms you live in.
          </p>
        </header>

        {productsDown ? (
          <EmptyState
            title="We couldn't load the arrivals."
            body="The catalog is taking a moment. Please try again shortly."
          >
            <Link className="zf-btn zf-btn--ghost" href="/new">
              Try again
            </Link>
          </EmptyState>
        ) : total === 0 ? (
          <EmptyState
            title={
              activeCount > 0
                ? "No arrivals match those filters."
                : "New arrivals are on the way."
            }
            body={
              activeCount > 0
                ? "Try widening your price range or removing a filter."
                : "Our next collection is being finished now. Explore the full range in the meantime."
            }
          >
            {activeCount > 0 ? (
              <Link className="zf-btn zf-btn--primary" href={clearHref}>
                Clear filters
              </Link>
            ) : (
              <CategorySuggestions
                categories={categories}
                heading="Explore the collection"
              />
            )}
          </EmptyState>
        ) : (
          <>
            <ActiveFilters
              pathname="/new"
              filters={filters}
              showMaterialColor
            />

            <div className="zf-catalog__layout">
              <CatalogFilterPanel
                action="/new"
                filters={filters}
                facets={productsResult.data.facets}
                showMaterialColor
              />

              <div className="zf-catalog__results">
                <CatalogResults
                  products={productsResult.data.items}
                  total={total}
                  page={productsResult.data.page}
                  pageSize={productsResult.data.page_size}
                  hrefForPage={(page) =>
                    catalogHref("/new", { filters, page })
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
