"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adminFetch,
  AdminApiError,
  type AdminCategory,
  type AdminProduct,
  type ProductListResponse,
} from "@/lib/adminApi";
import { formatCents } from "@/lib/money";

const inputClass =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10";

const PAGE_SIZE = 20;

function statusBadge(status: AdminProduct["status"]) {
  if (status === "active") {
    return "bg-green-100 text-green-800";
  }

  if (status === "archived") {
    return "bg-stone-200 text-stone-700";
  }

  return "bg-amber-100 text-amber-800";
}

function statusLabel(status: AdminProduct["status"]) {
  if (status === "active") {
    return "Active";
  }

  if (status === "archived") {
    return "Archived";
  }

  return "Draft";
}

export function ProductsClient() {
  const [items, setItems] = useState<AdminProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("");
  const [lowStock, setLowStock] = useState(false);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      try {
        const data = await adminFetch<AdminCategory[]>("/admin/categories");
        if (!cancelled) {
          setCategories(data);
        }
      } catch {
        // The filter simply stays empty if categories cannot be loaded.
      }
    }

    void loadCategories();

    return () => {
      cancelled = true;
    };
  }, []);

  const loadProducts = useCallback(async () => {
    setLoadStatus("loading");
    setError("");

    const params = new URLSearchParams({
      page: String(page),
      page_size: String(PAGE_SIZE),
    });

    if (search) {
      params.set("search", search);
    }
    if (categoryId) {
      params.set("category_id", categoryId);
    }
    if (status) {
      params.set("status", status);
    }
    if (lowStock) {
      params.set("low_stock", "true");
    }

    try {
      const data = await adminFetch<ProductListResponse>(
        `/admin/products?${params.toString()}`,
      );
      setItems(data.items);
      setTotal(data.total);
      setLoadStatus("ready");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load products.",
      );
      setLoadStatus("error");
    }
  }, [page, search, categoryId, status, lowStock]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      await Promise.resolve();
      if (!cancelled) {
        await loadProducts();
      }
    }

    void loadInitial();

    return () => {
      cancelled = true;
    };
  }, [loadProducts]);

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

  async function duplicateProduct(product: AdminProduct) {
    setBusyId(product.id);
    setActionError("");
    setNotice("");

    try {
      await adminFetch(`/admin/products/${product.id}/duplicate`, {
        method: "POST",
      });
      await loadProducts();
      setNotice(`Created a draft copy of "${product.name}".`);
    } catch (duplicateError) {
      setActionError(
        duplicateError instanceof Error
          ? duplicateError.message
          : "Unable to duplicate the product.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function deleteProduct(product: AdminProduct) {
    const confirmed = window.confirm(
      `Delete "${product.name}"? This cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    setBusyId(product.id);
    setActionError("");
    setNotice("");

    try {
      await adminFetch(`/admin/products/${product.id}`, {
        method: "DELETE",
      });
      await loadProducts();
      setNotice("Product deleted.");
    } catch (deleteError) {
      const message =
        deleteError instanceof AdminApiError
          ? deleteError.message
          : "Unable to delete the product.";
      setActionError(message);
    } finally {
      setBusyId(null);
    }
  }

  function resetFilters() {
    setSearchInput("");
    setSearch("");
    setCategoryId("");
    setStatus("");
    setLowStock(false);
    setPage(1);
  }

  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-stone-400">
            Catalog
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Products
          </h1>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Search, filter, and manage everything you sell. Prices are shown in
            US dollars.
          </p>
        </div>
        <Link
          href="/admin/products/new"
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
        >
          Add product
        </Link>
      </div>

      <div aria-live="polite" className="mt-4 space-y-2">
        {notice ? (
          <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            {notice}
          </p>
        ) : null}
        {actionError ? (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {actionError}
          </p>
        ) : null}
      </div>

      <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label
              htmlFor="product-search"
              className="block text-xs font-medium uppercase tracking-wide text-stone-500"
            >
              Search
            </label>
            <input
              id="product-search"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Name or SKU"
              className={`${inputClass} mt-1`}
            />
          </div>

          <div>
            <label
              htmlFor="product-category-filter"
              className="block text-xs font-medium uppercase tracking-wide text-stone-500"
            >
              Category
            </label>
            <select
              id="product-category-filter"
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value);
                setPage(1);
              }}
              className={`${inputClass} mt-1`}
            >
              <option value="">All categories</option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.parent_id ? `— ${category.name}` : category.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="product-status-filter"
              className="block text-xs font-medium uppercase tracking-wide text-stone-500"
            >
              Status
            </label>
            <select
              id="product-status-filter"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className={`${inputClass} mt-1`}
            >
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-2 text-sm text-stone-800">
              <input
                type="checkbox"
                checked={lowStock}
                onChange={(event) => {
                  setLowStock(event.target.checked);
                  setPage(1);
                }}
                className="h-4 w-4 rounded border-stone-300"
              />
              Low stock only
            </label>
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        {loadStatus === "loading" ? (
          <p className="px-4 py-10 text-center text-sm text-stone-500">
            Loading products...
          </p>
        ) : null}

        {loadStatus === "error" ? (
          <div className="px-4 py-10 text-center">
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
            <button
              type="button"
              onClick={() => void loadProducts()}
              className="mt-4 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
            >
              Try again
            </button>
          </div>
        ) : null}

        {loadStatus === "ready" && items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-stone-500">
            No products match these filters.
          </p>
        ) : null}

        {loadStatus === "ready" && items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-[1000px] w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Photo</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">SKU</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Stock</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((product) => {
                  const isSoldOut = product.stock_qty === 0;
                  const isLow =
                    product.stock_qty <= product.low_stock_threshold;

                  return (
                    <tr
                      key={product.id}
                      className="border-t border-stone-100 align-top"
                    >
                      <td className="px-4 py-3">
                        {product.primary_image_url ? (
                          <Image
                            src={product.primary_image_url}
                            alt={product.name}
                            width={48}
                            height={48}
                            className="h-12 w-12 rounded-lg border border-stone-200 object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 text-center text-[10px] leading-tight text-stone-400">
                            No photo
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-stone-900">
                          {product.name}
                        </p>
                        {product.is_featured ? (
                          <span className="mt-1 inline-flex rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-stone-600">
                            Featured
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-stone-600">
                        {product.sku ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-stone-600">
                        {product.category_name ?? "Uncategorized"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-stone-900">
                          {formatCents(product.price_cents)}
                        </span>
                        {product.sale_price_cents !== null ? (
                          <span className="mt-1 block text-xs font-medium text-red-700">
                            Sale {formatCents(product.sale_price_cents)}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {isSoldOut ? (
                          <span className="inline-flex rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800">
                            Sold out
                          </span>
                        ) : isLow ? (
                          <span className="inline-flex rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800">
                            {product.stock_qty} left
                          </span>
                        ) : (
                          <span className="text-stone-700">
                            {product.stock_qty} in stock
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusBadge(product.status)}`}
                        >
                          {statusLabel(product.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Link
                            href={`/admin/products/${product.id}`}
                            className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100"
                          >
                            Edit
                          </Link>
                          <button
                            type="button"
                            onClick={() => void duplicateProduct(product)}
                            disabled={busyId === product.id}
                            className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Duplicate
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteProduct(product)}
                            disabled={busyId === product.id}
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {loadStatus === "ready" ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 px-4 py-3 text-sm text-stone-600">
            <p>
              Showing {start}–{end} of {total}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs text-stone-500">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((value) => value + 1)}
                disabled={page >= totalPages}
                className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
