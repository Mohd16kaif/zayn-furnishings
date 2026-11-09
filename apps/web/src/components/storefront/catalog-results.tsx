import type { PublicProductCard } from "@zayn/shared";
import {
  ProductCard,
  type ProductTone,
} from "@/components/storefront/product-card";
import { CatalogPagination } from "@/components/storefront/catalog-pagination";

const TONES: ReadonlyArray<ProductTone> = [1, 2, 3, 4, 5, 6];

type CatalogResultsProps = {
  products: PublicProductCard[];
  total: number;
  page: number;
  pageSize: number;
  hrefForPage: (page: number) => string;
};

export function CatalogResults({
  products,
  total,
  page,
  pageSize,
  hrefForPage,
}: CatalogResultsProps) {
  if (products.length === 0) {
    return null;
  }

  const size = pageSize > 0 ? pageSize : products.length;
  const start = (page - 1) * size + 1;
  const end = Math.min(page * size, total);
  const totalPages = Math.max(1, Math.ceil(total / size));

  return (
    <>
      <p className="zf-catalog__showing">
        Showing {start} to {end} of {total} {total === 1 ? "piece" : "pieces"}
      </p>

      <div className="zf-product-grid">
        {products.map((product, index) => (
          <ProductCard
            key={product.id}
            product={{
              id: product.id,
              name: product.name,
              slug: product.slug,
              category: product.category_name,
              priceCents: product.price_cents,
              salePriceCents: product.sale_price_cents,
              inStock: product.in_stock,
              imageUrl: product.primary_image_url,
              tone: TONES[index % TONES.length],
            }}
          />
        ))}
      </div>

      <CatalogPagination
        page={page}
        totalPages={totalPages}
        hrefForPage={hrefForPage}
      />
    </>
  );
}
