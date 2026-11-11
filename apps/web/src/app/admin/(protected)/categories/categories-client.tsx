"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import {
  adminFetch,
  AdminApiError,
  type AdminCategory,
} from "@/lib/adminApi";

const inputClass =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10";

function bySortOrder(a: AdminCategory, b: AdminCategory): number {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
}

export function CategoriesClient() {
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [confirmCategory, setConfirmCategory] =
    useState<AdminCategory | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setError("");

    try {
      const data = await adminFetch<AdminCategory[]>("/admin/categories");
      setCategories(data);
      setStatus("ready");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load categories.",
      );
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      await Promise.resolve();
      if (!cancelled) {
        await load();
      }
    }

    void loadInitial();

    return () => {
      cancelled = true;
    };
  }, [load]);

  const topLevel = useMemo(
    () => categories.filter((item) => !item.parent_id).sort(bySortOrder),
    [categories],
  );

  const childrenByParent = useMemo(() => {
    const map = new Map<string, AdminCategory[]>();

    for (const category of categories) {
      if (!category.parent_id) {
        continue;
      }

      const list = map.get(category.parent_id) ?? [];
      list.push(category);
      map.set(category.parent_id, list);
    }

    for (const list of map.values()) {
      list.sort(bySortOrder);
    }

    return map;
  }, [categories]);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
    setNotice("");
  }

  function openEdit(category: AdminCategory) {
    setEditing(category);
    setFormOpen(true);
    setNotice("");
  }

  async function move(category: AdminCategory, direction: -1 | 1) {
    const siblings = categories
      .filter((item) => item.parent_id === category.parent_id)
      .sort(bySortOrder);
    const index = siblings.findIndex((item) => item.id === category.id);
    const target = index + direction;

    if (index < 0 || target < 0 || target >= siblings.length) {
      return;
    }

    const next = [...siblings];
    [next[index], next[target]] = [next[target], next[index]];

    setBusy(true);
    setActionError("");
    setNotice("");

    try {
      await adminFetch("/admin/categories/reorder", {
        method: "PATCH",
        json: next.map((item, position) => ({
          id: item.id,
          sort_order: position + 1,
        })),
      });
      await load();
      setNotice("Category order updated.");
    } catch (moveError) {
      setActionError(
        moveError instanceof Error
          ? moveError.message
          : "Unable to reorder categories.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteCategory(category: AdminCategory) {
    setConfirmCategory(null);
    setBusy(true);
    setActionError("");
    setNotice("");

    try {
      await adminFetch(`/admin/categories/${category.id}`, {
        method: "DELETE",
      });
      await load();
      setNotice("Category deleted.");
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete the category.",
      );
    } finally {
      setBusy(false);
    }
  }

  function renderRow(category: AdminCategory, depth: number) {
    const siblings = categories
      .filter((item) => item.parent_id === category.parent_id)
      .sort(bySortOrder);
    const index = siblings.findIndex((item) => item.id === category.id);

    return (
      <div
        key={category.id}
        className="flex flex-col gap-3 border-b border-stone-100 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
        style={{ paddingLeft: `${16 + depth * 28}px` }}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-stone-900">{category.name}</span>
            {category.is_active ? (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                Active
              </span>
            ) : (
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
                Hidden
              </span>
            )}
            {depth === 0 && childrenByParent.has(category.id) ? (
              <span className="text-xs text-stone-400">Parent</span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-stone-500">
            {category.product_count} product
            {category.product_count === 1 ? "" : "s"} &middot; /{category.slug}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void move(category, -1)}
            disabled={busy || index <= 0}
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={`Move ${category.name} up`}
          >
            Move up
          </button>
          <button
            type="button"
            onClick={() => void move(category, 1)}
            disabled={busy || index === siblings.length - 1}
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={`Move ${category.name} down`}
          >
            Move down
          </button>
          <button
            type="button"
            onClick={() => openEdit(category)}
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setConfirmCategory(category)}
            disabled={busy}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-stone-400">
            Catalog
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Categories
          </h1>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Organize products into top-level categories and subcategories. Use
            Move up and Move down to control the order customers see.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
        >
          Add category
        </button>
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

      <div className="mt-6 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        {status === "loading" ? (
          <p className="px-4 py-10 text-center text-sm text-stone-500">
            Loading categories...
          </p>
        ) : null}

        {status === "error" ? (
          <div className="px-4 py-10 text-center">
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-4 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
            >
              Try again
            </button>
          </div>
        ) : null}

        {status === "ready" && categories.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-stone-500">
            No categories yet. Add your first category to get started.
          </p>
        ) : null}

        {status === "ready"
          ? topLevel.map((parent) => (
              <div key={parent.id}>
                {renderRow(parent, 0)}
                {(childrenByParent.get(parent.id) ?? []).map((child) =>
                  renderRow(child, 1),
                )}
              </div>
            ))
          : null}
      </div>

      {formOpen ? (
        <CategoryForm
          categories={categories}
          editing={editing}
          onClose={() => setFormOpen(false)}
          onSaved={async () => {
            setFormOpen(false);
            await load();
            setNotice(editing ? "Category updated." : "Category created.");
          }}
        />
      ) : null}

      <ConfirmDialog
        open={confirmCategory !== null}
        title="Delete this category?"
        description={
          confirmCategory
            ? `"${confirmCategory.name}" will be removed from the catalog. Products in this category may need to be reassigned. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete category"
        busy={busy}
        onCancel={() => setConfirmCategory(null)}
        onConfirm={() => {
          if (confirmCategory) {
            void deleteCategory(confirmCategory);
          }
        }}
      />
    </div>
  );
}

function CategoryForm({
  categories,
  editing,
  onClose,
  onSaved,
}: {
  categories: AdminCategory[];
  editing: AdminCategory | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [parentId, setParentId] = useState(editing?.parent_id ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [isActive, setIsActive] = useState(editing?.is_active ?? true);
  const [seoTitle, setSeoTitle] = useState(editing?.seo_title ?? "");
  const [seoDescription, setSeoDescription] = useState(
    editing?.seo_description ?? "",
  );
  const [slug, setSlug] = useState(editing?.slug ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const hasChildren = editing
    ? categories.some((item) => item.parent_id === editing.id)
    : false;

  const parentOptions = categories
    .filter((item) => !item.parent_id && item.id !== editing?.id)
    .sort(bySortOrder);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setFieldErrors({});

    const payload = {
      name: name.trim(),
      parent_id: hasChildren ? null : parentId || null,
      description: description.trim() || null,
      is_active: isActive,
      seo_title: seoTitle.trim() || null,
      seo_description: seoDescription.trim() || null,
      ...(editing && slug.trim() ? { slug: slug.trim() } : {}),
    };

    try {
      if (editing) {
        await adminFetch(`/admin/categories/${editing.id}`, {
          method: "PATCH",
          json: payload,
        });
      } else {
        await adminFetch("/admin/categories", {
          method: "POST",
          json: payload,
        });
      }

      await onSaved();
    } catch (saveError) {
      if (saveError instanceof AdminApiError) {
        setFieldErrors(saveError.fields ?? {});
      }
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save the category.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-900/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-form-title"
        className="w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id="category-form-title"
            className="text-lg font-semibold text-stone-900"
          >
            {editing ? "Edit category" : "Add category"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-stone-300 px-3 py-1 text-sm text-stone-600 hover:bg-stone-100"
          >
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
          <div>
            <label
              htmlFor="category-name"
              className="block text-sm font-medium text-stone-800"
            >
              Name
            </label>
            <input
              id="category-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
              aria-invalid={Boolean(fieldErrors.name)}
            />
            {fieldErrors.name ? (
              <p role="alert" className="mt-1 text-xs text-red-700">
                {fieldErrors.name}
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="category-parent"
              className="block text-sm font-medium text-stone-800"
            >
              Parent category
            </label>
            <select
              id="category-parent"
              value={hasChildren ? "" : parentId}
              onChange={(event) => setParentId(event.target.value)}
              disabled={hasChildren}
              className={inputClass}
              aria-invalid={Boolean(fieldErrors.parent_id)}
            >
              <option value="">None (top level)</option>
              {parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-stone-500">
              {hasChildren
                ? "This category has subcategories, so it must stay at the top level."
                : "Choose a top-level category to nest this one underneath it."}
            </p>
            {fieldErrors.parent_id ? (
              <p role="alert" className="mt-1 text-xs text-red-700">
                {fieldErrors.parent_id}
              </p>
            ) : null}
          </div>

          {editing ? (
            <div>
              <label
                htmlFor="category-slug"
                className="block text-sm font-medium text-stone-800"
              >
                URL slug
              </label>
              <input
                id="category-slug"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                className={inputClass}
                aria-invalid={Boolean(fieldErrors.slug)}
              />
              <p className="mt-1 text-xs text-stone-500">
                The part of the web address customers see. Lowercase letters,
                numbers, and hyphens work best.
              </p>
              {fieldErrors.slug ? (
                <p role="alert" className="mt-1 text-xs text-red-700">
                  {fieldErrors.slug}
                </p>
              ) : null}
            </div>
          ) : null}

          <div>
            <label
              htmlFor="category-description"
              className="block text-sm font-medium text-stone-800"
            >
              Description
            </label>
            <textarea
              id="category-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-stone-500">
              Optional. A short description for this category.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm text-stone-800">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
              className="h-4 w-4 rounded border-stone-300"
            />
            Show this category on the store
          </label>

          <div>
            <label
              htmlFor="category-seo-title"
              className="block text-sm font-medium text-stone-800"
            >
              SEO title
            </label>
            <input
              id="category-seo-title"
              value={seoTitle}
              onChange={(event) => setSeoTitle(event.target.value)}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-stone-500">
              Optional. The title search engines show for this category.
            </p>
          </div>

          <div>
            <label
              htmlFor="category-seo-description"
              className="block text-sm font-medium text-stone-800"
            >
              SEO description
            </label>
            <textarea
              id="category-seo-description"
              value={seoDescription}
              onChange={(event) => setSeoDescription(event.target.value)}
              rows={2}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-stone-500">
              Optional. The summary search engines show for this category.
            </p>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save category"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
