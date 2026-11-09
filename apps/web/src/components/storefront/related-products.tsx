import type { PublicProductCard } from "@zayn/shared";
import {
  ProductCard,
  type ProductTone,
} from "@/components/storefront/product-card";

const TONES: ReadonlyArray<ProductTone> = [1, 2, 3, 4, 5, 6];

export function RelatedProducts({
  products,
}: {
  products: PublicProductCard[];
}) {
  if (products.length === 0) {
    return null;
  }

  return (
    <section className="zf-related" aria-labelledby="related-title">
      <div className="zf-container">
        <div className="zf-section-head zf-related__head">
          <div className="zf-section-head__copy">
            <span className="zf-eyebrow">You may also like</span>
            <h2 className="zf-heading" id="related-title">
              Pieces that live well together.
            </h2>
          </div>
        </div>

        <div
          className="zf-carousel"
          role="region"
          aria-label="Related products"
          tabIndex={0}
        >
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
      </div>
    </section>
  );
}
