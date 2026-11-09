import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { PublicCategoryNode } from "@zayn/shared";
import {
  activeFilterCount,
  catalogHref,
  clearedFilters,
  buildProductQuery,
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

type CategoryMatch = {
  category: PublicCategoryNode;
  parents: PublicCategoryNode[];
};

type CategoryWithSeo = PublicCategoryNode & {
  seo_title?: string | null;
  seo_description?: string | null;
};

type CategoryPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

function findCategory(
  nodes: PublicCategoryNode[],
  slug: string,
  parents: PublicCategoryNode[] = [],
): CategoryMatch | null {
  for (const node of nodes) {
    if (node.slug === slug) {
      return { category: node, parents };
    }

    const match = findCategory(node.children, slug, [...parents, node]);

    if (match) {
      return match;
    }
  }

  return null;
}

function categorySeo(category: PublicCategoryNode): {
  title: string | null;
  description: string | null;
} {
  const withSeo = category as CategoryWithSeo;

  return {
    title:
      typeof withSeo.seo_title === "string" && withSeo.seo_title.trim()
        ? withSeo.seo_title.trim()
        : null,
    description:
      typeof withSeo.seo_description === "string" &&
      withSeo.seo_description.trim()
        ? withSeo.seo_description.trim()
        : null,
  };
}

function breadcrumbJsonLd(match: CategoryMatch): string {
  const trail = [
    { name: "Home", path: "/" },
    ...match.parents.map((parent) => ({
      name: parent.name,
      path: `/c/${parent.slug}`,
    })),
    { name: match.category.name, path: `/c/${match.category.slug}` },
  ];

  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${baseUrl}${item.path}`,
    })),
  }).replace(/</g, "\\u003c");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { data } = await getCategories();
  const match = findCategory(data, slug);

  if (!match) {
    return {
      title: "Collection not found",
      robots: { index: false, follow: true },
    };
  }

  const { category, parents } = match;
  const seo = categorySeo(category);
  const title =
    seo.title ??
    (parents.length > 0
      ? `${category.name} — ${parents[parents.length - 1].name}`
      : category.name);
  const description =
    seo.description ??
    category.description ??
    `${category.name} — shop the collection at Zayn Furnishings.`;

  return {
    title,
    description,
    alternates: { canonical: `/c/${category.slug}` },
    openGraph: {
      title,
      description,
      url: `/c/${category.slug}`,
      type: "website",
    },
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: CategoryPageProps) {
  const [{ slug }, rawSearch] = await Promise.all([params, searchParams]);
  const filters = parseCatalogFilters(rawSearch);

  const [categoriesResult, productsResult] = await Promise.all([
    getCategories(),
    getProducts(buildProductQuery(filters, { categorySlug: slug })),
  ]);

  if (!categoriesResult.ok) {
    return (
      <section className="zf-catalog">
        <div className="zf-container">
          <EmptyState
            title="This collection is taking a moment."
            body="We couldn't load the catalog right now. Please try again shortly."
          >
            <Link className="zf-btn zf-btn--primary" href={`/c/${slug}`}>
              Try again
            </Link>
          </EmptyState>
        </div>
      </section>
    );
  }

  const match = findCategory(categoriesResult.data, slug);

  if (!match) {
    notFound();
  }

  const { category } = match;
  const activeCount = activeFilterCount(filters);
  const pathname = `/c/${category.slug}`;
  const clearHref = catalogHref(pathname, {
    filters: clearedFilters(filters),
  });
  const hasCategoryProducts = category.product_count > 0;
  const productsDown = !productsResult.ok;
  const total = productsResult.data.total;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd(match) }}
      />

      <section className="zf-catalog">
        <div className="zf-container">
          <header className="zf-catalog__header">
            <nav className="zf-breadcrumb" aria-label="Breadcrumb">
              <ol>
                <li>
                  <Link href="/">Home</Link>
                </li>
                {match.parents.map((parent) => (
                  <li key={parent.slug}>
                    <Link href={`/c/${parent.slug}`}>{parent.name}</Link>
                  </li>
                ))}
                <li aria-current="page">{category.name}</li>
              </ol>
            </nav>

            <div className="zf-catalog__title-row">
              <h1 className="zf-catalog__title">{category.name}</h1>
              <p className="zf-catalog__count">
                {pieceCountLabel(category.product_count)}
              </p>
            </div>

            {category.description ? (
              <p className="zf-catalog__description">{category.description}</p>
            ) : null}

            {category.children.length > 0 ? (
              <ul
                className="zf-catalog__subcategories"
                aria-label={`${category.name} subcategories`}
              >
                {category.children.map((child) => (
                  <li key={child.slug}>
                    <Link
                      className="zf-subcategory-chip"
                      href={`/c/${child.slug}`}
                    >
                      {child.name}
                      <span>{child.product_count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </header>

          {/* Empty categories stay reachable and show this state. Owners can
              deactivate unused categories in /admin/categories to remove
              them from the menu. */}
          {!hasCategoryProducts ? (
            <EmptyState
              title="Pieces arriving soon"
              body="We're still curating this collection. Explore another room in the meantime."
            >
              <CategorySuggestions
                categories={categoriesResult.data}
                heading="Other collections"
                excludeSlug={category.slug}
              />
            </EmptyState>
          ) : (
            <>
              <ActiveFilters
                pathname={pathname}
                filters={filters}
                showMaterialColor
              />

              <div className="zf-catalog__layout">
                <CatalogFilterPanel
                  action={pathname}
                  filters={filters}
                  facets={productsResult.data.facets}
                  showMaterialColor
                />

                <div className="zf-catalog__results">
                  {productsDown ? (
                    <EmptyState
                      title="We couldn't load these pieces."
                      body="The catalog is taking a moment. Please try again shortly."
                    >
                      <Link
                        className="zf-btn zf-btn--ghost"
                        href={catalogHref(pathname, { filters })}
                      >
                        Try again
                      </Link>
                    </EmptyState>
                  ) : total === 0 ? (
                    <EmptyState
                      title={
                        activeCount > 0
                          ? "No pieces match those filters."
                          : "Pieces arriving soon"
                      }
                      body={
                        activeCount > 0
                          ? "Try widening your price range or removing a filter."
                          : "We're still curating this collection. Explore another room in the meantime."
                      }
                    >
                      {activeCount > 0 ? (
                        <Link
                          className="zf-btn zf-btn--primary"
                          href={clearHref}
                        >
                          Clear filters
                        </Link>
                      ) : (
                        <CategorySuggestions
                          categories={categoriesResult.data}
                          heading="Other collections"
                          excludeSlug={category.slug}
                        />
                      )}
                    </EmptyState>
                  ) : (
                    <CatalogResults
                      products={productsResult.data.items}
                      total={total}
                      page={productsResult.data.page}
                      pageSize={productsResult.data.page_size}
                      hrefForPage={(page) =>
                        catalogHref(pathname, { filters, page })
                      }
                    />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
