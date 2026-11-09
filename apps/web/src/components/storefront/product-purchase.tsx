"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCart } from "@/components/design/cart-provider";

const QUANTITIES = Array.from({ length: 10 }, (_, index) => index + 1);

export type ProductPurchaseData = {
  id: string;
  slug: string;
  name: string;
  price_cents: number;
  image_url: string | null;
  in_stock: boolean;
};

export function ProductPurchase({
  product,
}: {
  product: ProductPurchaseData;
}) {
  const { add } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [toast, setToast] = useState<{ key: number } | null>(null);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = setTimeout(() => setToast(null), 5000);

    return () => clearTimeout(timeout);
  }, [toast]);

  function onAdd() {
    if (!product.in_stock) {
      return;
    }

    add(
      {
        productId: product.id,
        slug: product.slug,
        name: product.name,
        price_cents: product.price_cents,
        image_url: product.image_url,
      },
      quantity,
    );
    setToast({ key: Date.now() });
  }

  return (
    <div className="zf-pdp__purchase-wrap">
      <div className="zf-pdp__purchase">
        <label className="zf-qty" htmlFor="pdp-quantity">
          <span className="zf-qty__label">Quantity</span>
          <select
            id="pdp-quantity"
            name="quantity"
            value={quantity}
            disabled={!product.in_stock}
            onChange={(event) => setQuantity(Number(event.target.value))}
          >
            {QUANTITIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="zf-btn zf-btn--primary zf-pdp__add"
          onClick={onAdd}
          disabled={!product.in_stock}
          aria-label={
            product.in_stock
              ? `Add ${quantity} ${product.name} to cart`
              : `${product.name} is sold out`
          }
        >
          {product.in_stock ? "Add to cart" : "Sold out"}
        </button>
      </div>

      {toast ? (
        <div className="zf-toast" role="status">
          <span>Added to cart.</span>
          <Link className="zf-toast__link" href="/cart">
            View cart
          </Link>
          <button
            type="button"
            className="zf-toast__close"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
