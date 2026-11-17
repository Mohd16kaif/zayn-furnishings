"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MAX_ORDER_QTY } from "@zayn/shared";
import { useCart } from "@/components/design/cart-provider";

export type ProductPurchaseData = {
  id: string;
  slug: string;
  name: string;
  price_cents: number;
  image_url: string | null;
  in_stock: boolean;
  max_order_qty: number;
};

export function ProductPurchase({
  product,
}: {
  product: ProductPurchaseData;
}) {
  const { add, items } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [toast, setToast] = useState<{ key: number; message: string } | null>(
    null,
  );

  const inCart =
    items.find((item) => item.productId === product.id)?.quantity ?? 0;
  const maxOrderQuantity = Math.min(
    MAX_ORDER_QTY,
    Math.max(0, product.max_order_qty),
  );
  const remaining = Math.max(0, maxOrderQuantity - inCart);
  const atMax = product.in_stock && maxOrderQuantity > 0 && remaining === 0;
  const availableToAdd =
    product.in_stock && maxOrderQuantity > 0 && remaining > 0;
  const quantityOptions = Array.from(
    { length: Math.max(1, remaining) },
    (_, index) => index + 1,
  );
  const selectedQuantity = Math.min(quantity, Math.max(1, remaining));

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = setTimeout(() => setToast(null), 5000);

    return () => clearTimeout(timeout);
  }, [toast]);

  function onAdd() {
    if (!availableToAdd) {
      return;
    }

    const result = add(
      {
        productId: product.id,
        slug: product.slug,
        name: product.name,
        price_cents: product.price_cents,
        image_url: product.image_url,
      },
      Math.min(selectedQuantity, remaining),
      maxOrderQuantity,
    );

    setToast({
      key: Date.now(),
      message: result.capped
        ? `Only ${maxOrderQuantity} available. Your cart now has ${result.quantity}.`
        : "Added to cart.",
    });
  }

  return (
    <div className="zf-pdp__purchase-wrap">
      <div className="zf-pdp__purchase">
        <label className="zf-qty" htmlFor="pdp-quantity">
          <span className="zf-qty__label">Quantity</span>
          <select
            id="pdp-quantity"
            name="quantity"
            value={selectedQuantity}
            disabled={!availableToAdd}
            onChange={(event) => setQuantity(Number(event.target.value))}
          >
            {quantityOptions.map((value) => (
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
          disabled={!availableToAdd}
          aria-label={
            !product.in_stock
              ? `${product.name} is sold out`
              : atMax
                ? "You already have all available pieces in your cart"
                : `Add ${selectedQuantity} ${product.name} to cart`
          }
        >
          {product.in_stock ? "Add to cart" : "Sold out"}
        </button>
      </div>

      {atMax ? (
        <p className="zf-pdp__cart-max">
          You already have all available pieces in your cart
        </p>
      ) : null}

      {toast ? (
        <div className="zf-toast" role="status">
          <span>{toast.message}</span>
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
