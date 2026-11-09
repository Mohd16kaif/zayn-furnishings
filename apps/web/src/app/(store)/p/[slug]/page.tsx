import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type {
  PublicContentBlock,
  PublicProductDetail,
} from "@zayn/shared";
import { formatCents } from "@/lib/money";
import { getContentHome, getProduct, getSettings } from "@/lib/publicApi";
import { DeliveryPanel } from "@/components/storefront/delivery-panel";
import { EmptyState } from "@/components/storefront/empty-state";
import { ProductGallery } from "@/components/storefront/product-gallery";
import { ProductPurchase } from "@/components/storefront/product-purchase";
import { RelatedProducts } from "@/components/storefront/related-products";

export const instant = false;

const baseUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const DELIVERY_RETURNS_TITLES = [
  "delivery",
  "returns",
  "delivery and returns",
  "delivery & returns",
  "shipping and returns",
];

const CARE_TITLES = ["care", "product care", "care instructions"];

type ProductPageProps = {
  params: Promise<{ slug: string }>;
};

type SpecRow = {
  label: string;
  value: string;
};

function trimDescription(
  value: string | null,
  maxLength: number,
): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength).trimEnd()}…`
    : trimmed;
}

function paragraphsOf(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function safeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function findSectionContent(
  blocks: PublicContentBlock[],
  titles: string[],
): string | null {
  const matches = titles.map((title) => title.toLowerCase());
  const bodies: string[] = [];

  for (const block of blocks) {
    const title = block.title?.trim().toLowerCase();
    const body = block.body?.trim();

    if (title && body && matches.includes(title)) {
      bodies.push(body);
    }
  }

  return bodies.length > 0 ? bodies.join("\n\n") : null;
}

function specRowsFor(product: PublicProductDetail): SpecRow[] {
  const rows: SpecRow[] = [];
  const dimensions: string[] = [];

  if (product.dimensions.width_in !== null) {
    dimensions.push(`W ${product.dimensions.width_in} in`);
  }
  if (product.dimensions.depth_in !== null) {
    dimensions.push(`D ${product.dimensions.depth_in} in`);
  }
  if (product.dimensions.height_in !== null) {
    dimensions.push(`H ${product.dimensions.height_in} in`);
  }

  if (dimensions.length > 0) {
    rows.push({ label: "Dimensions", value: dimensions.join(" × ") });
  }

  if (product.dimensions.weight_lb !== null) {
    rows.push({
      label: "Weight",
      value: `${product.dimensions.weight_lb} lb`,
    });
  }

  if (product.material) {
    rows.push({ label: "Material", value: product.material });
  }

  if (product.color) {
    rows.push({ label: "Color", value: product.color });
  }

  return rows;
}

function breadcrumbJsonLd(product: PublicProductDetail): string {
  const trail = [
    { name: "Home", path: "/" },
    ...product.breadcrumb.map((item) => ({
      name: item.name,
      path: `/c/${item.slug}`,
    })),
    { name: product.name, path: `/p/${product.slug}` },
  ];

  return safeJsonLd({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${baseUrl}${item.path}`,
    })),
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const result = await getProduct(slug);

  if (!result.ok) {
    const missing = result.error === "HTTP 404";

    return {
      title: missing ? "Product not found" : "Product unavailable",
      robots: { index: false, follow: !missing },
    };
  }

  const product = result.data;
  const firstImage = product.images[0]?.url ?? null;
  const title = product.seo_title?.trim() || product.name;
  const description =
    product.seo_description?.trim() ||
    trimDescription(product.description, 160) ||
    product.name;

  return {
    title,
    description,
    alternates: { canonical: `/p/${product.slug}` },
    openGraph: {
      title,
      description,
      url: `/p/${product.slug}`,
      type: "website",
      ...(firstImage
        ? { images: [{ url: firstImage, alt: product.name }] }
        : {}),
    },
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;

  const [productResult, settingsResult, contentResult] = await Promise.all([
    getProduct(slug),
    getSettings(),
    getContentHome(),
  ]);

  if (!productResult.ok) {
    if (productResult.error === "HTTP 404") {
      notFound();
    }

    return (
      <section className="zf-pdp">
        <div className="zf-container">
          <EmptyState
            title="This piece is taking a moment."
            body="We couldn't load the product right now. Please try again shortly."
          >
            <Link className="zf-btn zf-btn--primary" href={`/p/${slug}`}>
              Try again
            </Link>
            <Link className="zf-btn zf-btn--ghost" href="/search">
              Browse the catalog
            </Link>
          </EmptyState>
        </div>
      </section>
    );
  }

  const product = productResult.data;
  const storeName = settingsResult.data.store_name;
  const contentBlocks = contentResult.ok
    ? Object.values(contentResult.data).flat()
    : [];

  const deliveryReturns = findSectionContent(
    contentBlocks,
    DELIVERY_RETURNS_TITLES,
  );
  const care = findSectionContent(contentBlocks, CARE_TITLES);

  const salePriceCents = product.sale_price_cents;
  const hasSale =
    salePriceCents !== null && salePriceCents < product.price_cents;
  const effectivePriceCents =
    hasSale && salePriceCents !== null
      ? salePriceCents
      : product.price_cents;
  const savingCents = hasSale
    ? product.price_cents - (salePriceCents ?? product.price_cents)
    : 0;

  const firstImage = product.images[0]?.url ?? null;
  const shortDescription = trimDescription(product.description, 220);
  const descriptionParagraphs = paragraphsOf(product.description);
  const specs = specRowsFor(product);
  const hasDetails =
    descriptionParagraphs.length > 0 ||
    specs.length > 0 ||
    Boolean(deliveryReturns) ||
    Boolean(care);

  const productJsonLd = safeJsonLd({
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    ...(firstImage ? { image: [firstImage] } : {}),
    ...(product.description ? { description: product.description } : {}),
    sku: product.slug,
    brand: {
      "@type": "Brand",
      name: storeName,
    },
    offers: {
      "@type": "Offer",
      url: `${baseUrl}/p/${product.slug}`,
      price: (effectivePriceCents / 100).toFixed(2),
      priceCurrency: "USD",
      availability: product.in_stock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
    },
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: productJsonLd }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd(product) }}
      />

      <section className="zf-pdp">
        <div className="zf-container">
          <nav className="zf-breadcrumb zf-pdp__crumb" aria-label="Breadcrumb">
            <ol>
              <li>
                <Link href="/">Home</Link>
              </li>
              {product.breadcrumb.map((item) => (
                <li key={item.slug}>
                  <Link href={`/c/${item.slug}`}>{item.name}</Link>
                </li>
              ))}
              <li aria-current="page">{product.name}</li>
            </ol>
          </nav>

          <div className="zf-pdp__layout">
            <ProductGallery
              name={product.name}
              images={product.images.map((image) => ({
                id: image.id,
                url: image.url,
                alt_text: image.alt_text,
              }))}
            />

            <div className="zf-pdp__info">
              {product.category ? (
                <Link
                  className="zf-pdp__category"
                  href={`/c/${product.category.slug}`}
                >
                  {product.category.name}
                </Link>
              ) : null}

              <h1 className="zf-pdp__title">{product.name}</h1>

              <div
                className={`zf-pdp__price${hasSale ? " zf-pdp__price--sale" : ""}`}
              >
                {hasSale ? (
                  <>
                    <strong>{formatCents(effectivePriceCents)}</strong>
                    <s>{formatCents(product.price_cents)}</s>
                  </>
                ) : (
                  <strong>{formatCents(product.price_cents)}</strong>
                )}
              </div>

              {hasSale ? (
                <p className="zf-pdp__save">
                  Save {formatCents(savingCents)}
                </p>
              ) : null}

              <span
                className={`zf-stock ${product.in_stock ? "zf-stock--in" : "zf-stock--out"}`}
              >
                {product.in_stock ? "In stock" : "Sold out"}
              </span>

              {shortDescription ? (
                <p className="zf-pdp__lede">{shortDescription}</p>
              ) : null}

              <ProductPurchase
                product={{
                  id: product.id,
                  slug: product.slug,
                  name: product.name,
                  price_cents: effectivePriceCents,
                  image_url: firstImage,
                  in_stock: product.in_stock,
                }}
              />

              <DeliveryPanel priceCents={effectivePriceCents} />
            </div>
          </div>

          {hasDetails ? (
            <section
              className="zf-pdp__details"
              aria-labelledby="pdp-details-title"
            >
              <div className="zf-pdp__details-main">
                <h2 id="pdp-details-title" className="zf-pdp__details-title">
                  Details
                </h2>
                {descriptionParagraphs.length > 0 ? (
                  <div className="zf-pdp__description">
                    {descriptionParagraphs.map((paragraph, index) => (
                      <p key={`description-${index}`}>{paragraph}</p>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="zf-pdp__details-side">
                {specs.length > 0 ? (
                  <div className="zf-specs">
                    <h3 className="zf-specs__title">Specifications</h3>
                    <dl className="zf-specs__table">
                      {specs.map((row) => (
                        <div className="zf-specs__row" key={row.label}>
                          <dt>{row.label}</dt>
                          <dd>{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ) : null}

                {deliveryReturns ? (
                  <details className="zf-accordion">
                    <summary className="zf-accordion__summary">
                      Delivery and returns
                      <span className="zf-accordion__icon" aria-hidden="true" />
                    </summary>
                    <div className="zf-accordion__body">
                      {paragraphsOf(deliveryReturns).map((paragraph, index) => (
                        <p key={`delivery-${index}`}>{paragraph}</p>
                      ))}
                    </div>
                  </details>
                ) : null}

                {care ? (
                  <details className="zf-accordion">
                    <summary className="zf-accordion__summary">
                      Care
                      <span className="zf-accordion__icon" aria-hidden="true" />
                    </summary>
                    <div className="zf-accordion__body">
                      {paragraphsOf(care).map((paragraph, index) => (
                        <p key={`care-${index}`}>{paragraph}</p>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </section>

      <RelatedProducts products={product.related_products} />
    </>
  );
}
