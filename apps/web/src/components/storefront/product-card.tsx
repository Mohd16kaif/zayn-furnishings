import Link from "next/link";
import { SmartImage } from "@/components/design/smart-image";
import { formatCents } from "@/lib/money";

export type ProductTone = 1 | 2 | 3 | 4 | 5 | 6;

export type ProductCardData = {
  id: string;
  name: string;
  /** When present, the whole card links to /p/<slug>. */
  slug?: string | null;
  category?: string | null;
  priceCents?: number;
  salePriceCents?: number | null;
  /** Pre-formatted overrides (design preview keeps its own labels). */
  priceLabel?: string;
  salePriceLabel?: string;
  inStock?: boolean;
  imageUrl?: string | null;
  tone?: ProductTone;
};

export function ProductCard({ product }: { product: ProductCardData }) {
  const {
    name,
    slug,
    category,
    priceCents = 0,
    salePriceCents,
    priceLabel,
    salePriceLabel,
    inStock = true,
    imageUrl,
    tone = 1,
  } = product;

  const onSale =
    salePriceLabel !== undefined ||
    (salePriceCents !== null && salePriceCents !== undefined);
  const effectivePrice = priceLabel ?? formatCents(priceCents);
  const effectiveSale = salePriceLabel ?? formatCents(salePriceCents);

  const contents = (
    <>
      <div className="zf-product__media">
        <SmartImage
          src={imageUrl ?? undefined}
          alt={`${name} product photo`}
          sizes="(max-width: 560px) 78vw, 320px"
          tone={tone}
          label="Product"
        />
        {inStock === false ? (
          <span className="zf-product__badge">Sold out</span>
        ) : null}
      </div>
      <div className="zf-product__body">
        {category ? <span className="zf-product__meta">{category}</span> : null}
        <h3 className="zf-product__name">{name}</h3>
        <div
          className={`zf-product__price${
            onSale ? " zf-product__price--sale" : ""
          }`}
        >
          {onSale ? (
            <>
              <s>{effectivePrice}</s>
              <strong>{effectiveSale}</strong>
              <span className="zf-product__meta">Sale</span>
            </>
          ) : (
            <strong>{effectivePrice}</strong>
          )}
        </div>
      </div>
    </>
  );

  if (slug) {
    return (
      <Link className="zf-product" href={`/p/${slug}`}>
        {contents}
      </Link>
    );
  }

  return <article className="zf-product">{contents}</article>;
}
