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
  "Shop reduced furniture and limited-time savings at Zayn Furnishings.";

export const metadata: Metadata = {
  title: "Sale",
  description,
  alternates: { canonical: "/sale" },
  openGraph: {
    title: "Sale",
    description,
    url: "/sale",
    type: "website",
  },
};

type SalePageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function SalePage({ searchParams }: SalePageProps) {
  const rawSearch = await searchParams;
  const filters = parseCatalogFilters(rawSearch);

  const [categoriesResult, productsResult] = await Promise.all([
    getCategories(),
    getProducts({ ...buildProductQuery(filters), onSale: true }),
  ]);

  const categories = categoriesResult.data;
  const activeCount = activeFilterCount(filters);
  const productsDown = !productsResult.ok;
  const total = productsResult.data.total;
  const clearHref = catalogHref("/sale", {
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
              <li aria-current="page">Sale</li>
            </ol>
          </nav>

          <div className="zf-catalog__title-row">
            <h1 className="zf-catalog__title">Sale</h1>
            {!productsDown && total > 0 ? (
              <p className="zf-catalog__count">{pieceCountLabel(total)}</p>
            ) : null}
          </div>

          <p className="zf-catalog__description">
            Exceptional pieces, thoughtfully reduced — limited-time
            savings across the collection while stocks last.
          </p>
        </header>

        {productsDown ? (
          <EmptyState
            title="We couldn't load the sale."
            body="The catalog is taking a moment. Please try again shortly."
          >
            <Link className="zf-btn zf-btn--ghost" href="/sale">
              Try again
            </Link>
          </EmptyState>
        ) : total === 0 ? (
          <EmptyState
            title={
              activeCount > 0
                ? "No sale pieces match those filters."
                : "No sale pieces right now."
            }
            body={
              activeCount > 0
                ? "Try widening your price range or removing a filter."
                : "Our seasonal savings have wrapped up. Explore the full collection for pieces to love."
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
              pathname="/sale"
              filters={filters}
              showMaterialColor
            />

            <div className="zf-catalog__layout">
              <CatalogFilterPanel
                action="/sale"
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
                    catalogHref("/sale", { filters, page })
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
