"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  adminFetch,
  AdminApiError,
  type AdminCategory,
  type AdminProduct,
} from "@/lib/adminApi";
import {
  centsToDollarInput,
  dollarsToCents,
  formatCents,
} from "@/lib/money";
import { ProductImages } from "./product-images";

const inputClass =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 disabled:bg-stone-100 disabled:text-stone-500";

type ProductStatus = "draft" | "active" | "archived";
type StockMode = "add" | "remove" | "set";
type StockReason = "restock" | "manual_adjust" | "correction" | "return";

type ProductFormState = {
  name: string;
  description: string;
  categoryId: string;
  status: ProductStatus;
  price: string;
  salePrice: string;
  sku: string;
  stockQty: string;
  lowStockThreshold: string;
  width: string;
  depth: string;
  height: string;
  weight: string;
  material: string;
  color: string;
  seoTitle: string;
  seoDescription: string;
  isFeatured: boolean;
};

const emptyForm: ProductFormState = {
  name: "",
  description: "",
  categoryId: "",
  status: "draft",
  price: "",
  salePrice: "",
  sku: "",
  stockQty: "0",
  lowStockThreshold: "2",
  width: "",
  depth: "",
  height: "",
  weight: "",
  material: "",
  color: "",
  seoTitle: "",
  seoDescription: "",
  isFeatured: false,
};

function formFromProduct(product: AdminProduct): ProductFormState {
  return {
    name: product.name,
    description: product.description ?? "",
    categoryId: product.category_id ?? "",
    status: product.status,
    price: centsToDollarInput(product.price_cents),
    salePrice:
      product.sale_price_cents === null
        ? ""
        : centsToDollarInput(product.sale_price_cents),
    sku: product.sku ?? "",
    stockQty: String(product.stock_qty),
    lowStockThreshold: String(product.low_stock_threshold),
    width: product.width_in === null ? "" : String(product.width_in),
    depth: product.depth_in === null ? "" : String(product.depth_in),
    height: product.height_in === null ? "" : String(product.height_in),
    weight: product.weight_lb === null ? "" : String(product.weight_lb),
    material: product.material ?? "",
    color: product.color ?? "",
    seoTitle: product.seo_title ?? "",
    seoDescription: product.seo_description ?? "",
    isFeatured: product.is_featured,
  };
}

function parseWhole(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function parseOptionalDecimal(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return "invalid";
  }

  return parsed;
}

export function ProductForm({
  productId,
  initialSaved = false,
}: {
  productId?: string;
  initialSaved?: boolean;
}) {
  const router = useRouter();
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [product, setProduct] = useState<AdminProduct | null>(null);
  const [form, setForm] = useState<ProductFormState>(emptyForm);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState(
    initialSaved ? "Product saved successfully." : "",
  );

  const [stockMode, setStockMode] = useState<StockMode>("add");
  const [stockQuantity, setStockQuantity] = useState("1");
  const [stockReason, setStockReason] = useState<StockReason>("restock");
  const [stockNote, setStockNote] = useState("");
  const [stockSaving, setStockSaving] = useState(false);
  const [stockError, setStockError] = useState("");
  const [stockNotice, setStockNotice] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("loading");
      setLoadError("");

      try {
        const categoryData = await adminFetch<AdminCategory[]>(
          "/admin/categories",
        );

        if (productId) {
          const productData = await adminFetch<AdminProduct>(
            `/admin/products/${productId}`,
          );

          if (!cancelled) {
            setCategories(categoryData);
            setProduct(productData);
            setForm(formFromProduct(productData));
          }
        } else if (!cancelled) {
          setCategories(categoryData);
        }

        if (!cancelled) {
          setStatus("ready");
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Unable to load this product.",
          );
          setStatus("error");
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [productId]);

  const categoryOptions = useMemo(() => {
    const topLevel = categories
      .filter((item) => !item.parent_id)
      .sort(
        (a, b) =>
          a.sort_order - b.sort_order || a.name.localeCompare(b.name),
      );
    const options: AdminCategory[] = [];

    for (const parent of topLevel) {
      options.push(parent);
      const children = categories
        .filter((item) => item.parent_id === parent.id)
        .sort(
          (a, b) =>
            a.sort_order - b.sort_order || a.name.localeCompare(b.name),
        );
      options.push(...children);
    }

    return options;
  }, [categories]);

  const priceCents = dollarsToCents(form.price);
  const saleCents = form.salePrice.trim()
    ? dollarsToCents(form.salePrice)
    : null;
  const liveSaleError =
    saleCents !== null &&
    priceCents !== null &&
    saleCents >= priceCents
      ? "Sale price must be less than the regular price."
      : "";

  function setField<K extends keyof ProductFormState>(
    key: K,
    value: ProductFormState[K],
  ) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setFieldErrors({});
    setNotice("");

    const errors: Record<string, string> = {};

    if (!form.name.trim()) {
      errors.name = "Name is required.";
    }

    if (!form.sku.trim()) {
      errors.sku = "SKU is required.";
    }

    const price = dollarsToCents(form.price);
    if (price === null) {
      errors.price_cents = "Enter a valid price, for example 1299.00.";
    }

    const sale = form.salePrice.trim()
      ? dollarsToCents(form.salePrice)
      : null;
    if (form.salePrice.trim() && sale === null) {
      errors.sale_price_cents = "Enter a valid sale price.";
    } else if (sale !== null && price !== null && sale >= price) {
      errors.sale_price_cents =
        "Sale price must be less than the regular price.";
    }

    const lowStockThreshold = parseWhole(form.lowStockThreshold);
    if (lowStockThreshold === null) {
      errors.low_stock_threshold = "Enter a whole number of 0 or more.";
    }

    const stockQty = parseWhole(form.stockQty);
    if (!productId && stockQty === null) {
      errors.stock_qty = "Enter a whole number of 0 or more.";
    }

    const width = parseOptionalDecimal(form.width);
    if (width === "invalid") {
      errors.width_in = "Enter a number of 0 or more.";
    }
    const depth = parseOptionalDecimal(form.depth);
    if (depth === "invalid") {
      errors.depth_in = "Enter a number of 0 or more.";
    }
    const height = parseOptionalDecimal(form.height);
    if (height === "invalid") {
      errors.height_in = "Enter a number of 0 or more.";
    }
    const weight = parseOptionalDecimal(form.weight);
    if (weight === "invalid") {
      errors.weight_lb = "Enter a number of 0 or more.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError("Please check the highlighted fields.");
      return;
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      price_cents: price,
      sale_price_cents: sale,
      sku: form.sku.trim(),
      low_stock_threshold: lowStockThreshold,
      width_in: width === "invalid" ? null : width,
      depth_in: depth === "invalid" ? null : depth,
      height_in: height === "invalid" ? null : height,
      weight_lb: weight === "invalid" ? null : weight,
      material: form.material.trim() || null,
      color: form.color.trim() || null,
      status: form.status,
      category_id: form.categoryId || null,
      is_featured: form.isFeatured,
      seo_title: form.seoTitle.trim() || null,
      seo_description: form.seoDescription.trim() || null,
      ...(productId ? {} : { stock_qty: stockQty }),
    };

    setSaving(true);

    try {
      if (productId) {
        const updated = await adminFetch<AdminProduct>(
          `/admin/products/${productId}`,
          { method: "PATCH", json: payload },
        );
        setProduct(updated);
        setForm(formFromProduct(updated));
        setNotice("Product saved successfully.");
      } else {
        const created = await adminFetch<AdminProduct>("/admin/products", {
          method: "POST",
          json: payload,
        });
        router.replace(`/admin/products/${created.id}?saved=1`);
      }
    } catch (error) {
      if (error instanceof AdminApiError) {
        setFieldErrors(error.fields ?? {});
      }
      setFormError(
        error instanceof Error
          ? error.message
          : "Unable to save the product.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleStock(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!productId) {
      return;
    }

    setStockError("");
    setStockNotice("");

    const quantity = parseWhole(stockQuantity);
    if (quantity === null) {
      setStockError("Enter a whole number of 0 or more.");
      return;
    }

    setStockSaving(true);

    try {
      const result = await adminFetch<{ stock_qty: number }>(
        `/admin/products/${productId}/stock`,
        {
          method: "POST",
          json: {
            mode: stockMode,
            quantity,
            reason: stockReason,
            note: stockNote.trim() || null,
          },
        },
      );

      setProduct((previous) =>
        previous ? { ...previous, stock_qty: result.stock_qty } : previous,
      );
      setForm((previous) => ({
        ...previous,
        stockQty: String(result.stock_qty),
      }));
      setStockNotice(`Stock is now ${result.stock_qty}.`);
      setStockNote("");
    } catch (error) {
      setStockError(
        error instanceof Error
          ? error.message
          : "Unable to update stock.",
      );
    } finally {
      setStockSaving(false);
    }
  }

  if (status === "loading") {
    return (
      <p className="py-16 text-center text-sm text-stone-500">
        Loading product...
      </p>
    );
  }

  if (status === "error") {
    return (
      <div className="py-16 text-center">
        <p role="alert" className="text-sm text-red-700">
          {loadError}
        </p>
        <Link
          href="/admin/products"
          className="mt-4 inline-block rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
        >
          Back to products
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-stone-400">
            Catalog
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {productId ? "Edit product" : "Add product"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Fill in the details below. You can save at any time and come back to
            finish later.
          </p>
        </div>
        <Link
          href="/admin/products"
          className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
        >
          Back to products
        </Link>
      </div>

      <div aria-live="polite" className="mt-4 space-y-2">
        {notice ? (
          <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            {notice}
          </p>
        ) : null}
      </div>

      {!productId ? (
        <p className="mt-4 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
          Save the product first, then add photos.
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-6 space-y-6" noValidate>
        <Section
          title="Basics"
          description="The name customers see and where the product appears."
        >
          <Field
            label="Product name"
            htmlFor="product-name"
            error={fieldErrors.name}
            className="sm:col-span-2"
          >
            <input
              id="product-name"
              value={form.name}
              onChange={(event) => setField("name", event.target.value)}
              className={inputClass}
              aria-invalid={Boolean(fieldErrors.name)}
            />
          </Field>

          <Field label="Category" htmlFor="product-category">
            <select
              id="product-category"
              value={form.categoryId}
              onChange={(event) =>
                setField("categoryId", event.target.value)
              }
              className={inputClass}
              aria-invalid={Boolean(fieldErrors.category_id)}
            >
              <option value="">No category</option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.parent_id ? `— ${category.name}` : category.name}
                </option>
              ))}
            </select>
            {fieldErrors.category_id ? (
              <p role="alert" className="mt-1 text-xs text-red-700">
                {fieldErrors.category_id}
              </p>
            ) : null}
          </Field>

          <Field
            label="Status"
            htmlFor="product-status"
            hint="Draft is hidden. Active is visible in the store. Archived is hidden but kept for records."
          >
            <select
              id="product-status"
              value={form.status}
              onChange={(event) =>
                setField("status", event.target.value as ProductStatus)
              }
              className={inputClass}
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </Field>

          <Field
            label="Description"
            htmlFor="product-description"
            hint="Describe the materials, size, and anything that makes this piece special."
            className="sm:col-span-2"
          >
            <textarea
              id="product-description"
              value={form.description}
              onChange={(event) =>
                setField("description", event.target.value)
              }
              rows={4}
              className={inputClass}
            />
          </Field>
        </Section>

        {productId && product ? (
          <ProductImages
            productId={productId}
            initialImages={product.images ?? []}
          />
        ) : null}

        <Section
          title="Pricing"
          description="Enter prices in US dollars. Sale price is optional."
        >
          <Field
            label="Price (USD)"
            htmlFor="product-price"
            hint="For example, 1299.00 for one thousand two hundred ninety-nine dollars."
            error={fieldErrors.price_cents}
          >
            <input
              id="product-price"
              inputMode="decimal"
              value={form.price}
              onChange={(event) => setField("price", event.target.value)}
              className={inputClass}
              aria-invalid={Boolean(fieldErrors.price_cents)}
              placeholder="1299.00"
            />
          </Field>

          <Field
            label="Sale price (USD)"
            htmlFor="product-sale-price"
            hint="Leave blank if this product is not on sale."
            error={fieldErrors.sale_price_cents ?? liveSaleError}
          >
            <input
              id="product-sale-price"
              inputMode="decimal"
              value={form.salePrice}
              onChange={(event) => setField("salePrice", event.target.value)}
              className={inputClass}
              aria-invalid={Boolean(
                fieldErrors.sale_price_cents ?? liveSaleError,
              )}
              placeholder="Optional"
            />
          </Field>
        </Section>

        <Section
          title="Inventory"
          description="Track how many you have on hand and when to reorder."
        >
          <Field
            label="SKU"
            htmlFor="product-sku"
            hint="Your internal product code. It must be unique."
            error={fieldErrors.sku}
          >
            <input
              id="product-sku"
              value={form.sku}
              onChange={(event) => setField("sku", event.target.value)}
              className={inputClass}
              aria-invalid={Boolean(fieldErrors.sku)}
            />
          </Field>

          <Field
            label="Low stock threshold"
            htmlFor="product-low-stock"
            hint="We flag this product when stock reaches this number."
            error={fieldErrors.low_stock_threshold}
          >
            <input
              id="product-low-stock"
              inputMode="numeric"
              value={form.lowStockThreshold}
              onChange={(event) =>
                setField("lowStockThreshold", event.target.value)
              }
              className={inputClass}
              aria-invalid={Boolean(fieldErrors.low_stock_threshold)}
            />
          </Field>

          {productId ? (
            <Field
              label="Current stock"
              htmlFor="product-current-stock"
              hint="Stock changes only through the Adjust stock panel below."
              className="sm:col-span-2"
            >
              <input
                id="product-current-stock"
                value={product ? String(product.stock_qty) : ""}
                readOnly
                disabled
                className={inputClass}
              />
            </Field>
          ) : (
            <Field
              label="Starting stock"
              htmlFor="product-stock"
              hint="How many you have right now. You can adjust this later."
              error={fieldErrors.stock_qty}
              className="sm:col-span-2"
            >
              <input
                id="product-stock"
                inputMode="numeric"
                value={form.stockQty}
                onChange={(event) =>
                  setField("stockQty", event.target.value)
                }
                className={inputClass}
                aria-invalid={Boolean(fieldErrors.stock_qty)}
              />
            </Field>
          )}
        </Section>

        {productId ? (
          <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-stone-900">
              Adjust stock
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              Current stock:{" "}
              <span className="font-medium text-stone-900">
                {product ? product.stock_qty : 0}
              </span>
              . Every change is recorded.
            </p>

            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Action" htmlFor="stock-mode">
                  <select
                    id="stock-mode"
                    value={stockMode}
                    onChange={(event) =>
                      setStockMode(event.target.value as StockMode)
                    }
                    className={inputClass}
                  >
                    <option value="add">Add stock</option>
                    <option value="remove">Remove stock</option>
                    <option value="set">Set exact stock</option>
                  </select>
                </Field>

                <Field label="Quantity" htmlFor="stock-quantity">
                  <input
                    id="stock-quantity"
                    inputMode="numeric"
                    value={stockQuantity}
                    onChange={(event) =>
                      setStockQuantity(event.target.value)
                    }
                    className={inputClass}
                  />
                </Field>

                <Field
                  label="Reason"
                  htmlFor="stock-reason"
                  hint="Choose the reason that best matches this change."
                >
                  <select
                    id="stock-reason"
                    value={stockReason}
                    onChange={(event) =>
                      setStockReason(event.target.value as StockReason)
                    }
                    className={inputClass}
                  >
                    <option value="restock">Restock (new stock arrived)</option>
                    <option value="manual_adjust">Manual adjustment</option>
                    <option value="correction">Correction</option>
                    <option value="return">Customer return</option>
                  </select>
                </Field>

                <Field label="Note" htmlFor="stock-note" hint="Optional.">
                  <input
                    id="stock-note"
                    value={stockNote}
                    onChange={(event) => setStockNote(event.target.value)}
                    className={inputClass}
                    placeholder="For example, received from supplier"
                  />
                </Field>
              </div>

              {stockError ? (
                <p role="alert" className="text-sm text-red-700">
                  {stockError}
                </p>
              ) : null}

              {stockNotice ? (
                <p className="text-sm text-green-700">{stockNotice}</p>
              ) : null}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleStock()}
                  disabled={stockSaving}
                  className="rounded-lg border border-stone-900 px-4 py-2 text-sm font-medium text-stone-900 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {stockSaving ? "Updating..." : "Update stock"}
                </button>
              </div>
            </div>
          </section>
        ) : null}

        <Section
          title="Details"
          description="Measurements help customers choose the right piece."
        >
          <Field
            label="Width (inches)"
            htmlFor="product-width"
            error={fieldErrors.width_in}
          >
            <input
              id="product-width"
              inputMode="decimal"
              value={form.width}
              onChange={(event) => setField("width", event.target.value)}
              className={inputClass}
              aria-invalid={Boolean(fieldErrors.width_in)}
            />
          </Field>

          <Field
            label="Depth (inches)"
            htmlFor="product-depth"
            error={fieldErrors.depth_in}
          >
            <input
              id="product-depth"
              inputMode="decimal"
              value={form.depth}
              onChange={(event) => setField("depth", event.target.value)}
              className={inputClass}
              aria-invalid={Boolean(fieldErrors.depth_in)}
            />
          </Field>

          <Field
            label="Height (inches)"
            htmlFor="product-height"
            error={fieldErrors.height_in}
          >
            <input
              id="product-height"
              inputMode="decimal"
              value={form.height}
              onChange={(event) => setField("height", event.target.value)}
              className={inputClass}
              aria-invalid={Boolean(fieldErrors.height_in)}
            />
          </Field>

          <Field
            label="Weight (pounds)"
            htmlFor="product-weight"
            error={fieldErrors.weight_lb}
          >
            <input
              id="product-weight"
              inputMode="decimal"
              value={form.weight}
              onChange={(event) => setField("weight", event.target.value)}
              className={inputClass}
              aria-invalid={Boolean(fieldErrors.weight_lb)}
            />
          </Field>

          <Field label="Material" htmlFor="product-material">
            <input
              id="product-material"
              value={form.material}
              onChange={(event) => setField("material", event.target.value)}
              className={inputClass}
              placeholder="For example, solid oak"
            />
          </Field>

          <Field label="Color" htmlFor="product-color">
            <input
              id="product-color"
              value={form.color}
              onChange={(event) => setField("color", event.target.value)}
              className={inputClass}
              placeholder="For example, natural walnut"
            />
          </Field>
        </Section>

        <Section
          title="SEO"
          description="Optional details for search engines. Leave blank to use the product name."
        >
          <Field
            label="SEO title"
            htmlFor="product-seo-title"
            className="sm:col-span-2"
          >
            <input
              id="product-seo-title"
              value={form.seoTitle}
              onChange={(event) => setField("seoTitle", event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field
            label="SEO description"
            htmlFor="product-seo-description"
            className="sm:col-span-2"
          >
            <textarea
              id="product-seo-description"
              value={form.seoDescription}
              onChange={(event) =>
                setField("seoDescription", event.target.value)
              }
              rows={2}
              className={inputClass}
            />
          </Field>
        </Section>

        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <label className="flex items-center gap-2 text-sm text-stone-800">
            <input
              type="checkbox"
              checked={form.isFeatured}
              onChange={(event) =>
                setField("isFeatured", event.target.checked)
              }
              className="h-4 w-4 rounded border-stone-300"
            />
            Feature this product on the store
          </label>
          <p className="mt-1 text-xs text-stone-500">
            Featured products can be highlighted on the home page and in
            promotions.
          </p>
        </section>

        {formError ? (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {formError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/admin/products"
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
          >
            Back to products
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save product"}
          </button>
        </div>

        {product ? (
          <p className="text-xs text-stone-500">
            Price: {formatCents(product.price_cents)}
            {product.sale_price_cents !== null
              ? ` · Sale: ${formatCents(product.sale_price_cents)}`
              : ""}
          </p>
        ) : null}
      </form>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-stone-900">{title}</h2>
      <p className="mt-1 text-sm text-stone-600">{description}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  className = "",
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-stone-800"
      >
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${htmlFor}-hint`} className="mt-1 text-xs text-stone-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
