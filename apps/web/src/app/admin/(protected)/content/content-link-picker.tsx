"use client";

import { useMemo, useState } from "react";
import { validateContentLink } from "@zayn/shared";
import type { AdminCategory } from "@/lib/adminApi";

type LinkOption = {
  label: string;
  value: string;
  group: "Pages" | "Categories";
};

function pageOptions(categories: AdminCategory[]): LinkOption[] {
  const options: LinkOption[] = [
    { label: "Home", value: "/", group: "Pages" },
    { label: "New arrivals", value: "/new", group: "Pages" },
    { label: "Sale", value: "/sale", group: "Pages" },
    { label: "Cart", value: "/cart", group: "Pages" },
  ];

  const activeCategories = categories
    .filter((category) => category.is_active)
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order || a.name.localeCompare(b.name),
    );

  for (const category of activeCategories) {
    options.push({
      label: category.name,
      value: `/c/${category.slug}`,
      group: "Categories",
    });
  }

  return options;
}

export function ContentLinkPicker({
  value,
  categories,
  onChange,
  fieldError,
  disabled = false,
}: {
  value: string | null;
  categories: AdminCategory[];
  onChange: (value: string | null) => void;
  fieldError?: string;
  disabled?: boolean;
}) {
  const options = useMemo(() => pageOptions(categories), [categories]);
  const knownValue = value
    ? options.some((option) => option.value === value)
    : false;

  const [selection, setSelection] = useState(
    value ? (knownValue ? value : "__custom__") : "",
  );
  const [custom, setCustom] = useState(knownValue ? "" : (value ?? ""));

  const currentLink =
    selection === "__custom__" ? custom.trim() : selection;
  const linkError =
    selection === "__custom__" ? validateContentLink(custom) : null;
  const mayBeBroken =
    Boolean(currentLink) &&
    currentLink.startsWith("/") &&
    !options.some((option) => option.value === currentLink) &&
    !linkError;

  function handleSelection(next: string) {
    setSelection(next);

    if (next === "__custom__") {
      onChange(custom.trim() || null);
      return;
    }

    setCustom("");
    onChange(next || null);
  }

  return (
    <div>
      <label
        htmlFor="content-link-select"
        className="block text-sm font-medium text-stone-800"
      >
        Link to
      </label>
      <select
        id="content-link-select"
        value={selection}
        disabled={disabled}
        onChange={(event) => handleSelection(event.target.value)}
        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 disabled:bg-stone-100 disabled:text-stone-500"
      >
        <option value="">Choose a page (optional)</option>
        <optgroup label="Pages">
          {options
            .filter((option) => option.group === "Pages")
            .map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
        </optgroup>
        {options.some((option) => option.group === "Categories") ? (
          <optgroup label="Categories">
            {options
              .filter((option) => option.group === "Categories")
              .map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
          </optgroup>
        ) : null}
        <option value="__custom__">Custom link</option>
      </select>

      {selection === "__custom__" ? (
        <div className="mt-2">
          <label
            htmlFor="content-custom-link"
            className="block text-xs font-medium text-stone-700"
          >
            Custom link
          </label>
          <input
            id="content-custom-link"
            value={custom}
            disabled={disabled}
            onChange={(event) => {
              setCustom(event.target.value);
              onChange(event.target.value.trim() || null);
            }}
            placeholder="/c/sofas or https://example.com"
            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 disabled:bg-stone-100 disabled:text-stone-500"
            aria-invalid={Boolean(linkError || fieldError)}
          />
          <p className="mt-1 text-xs text-stone-500">
            Use a path starting with / or a full https:// address.
          </p>
          {linkError ? (
            <p role="alert" className="mt-1 text-xs text-red-700">
              {linkError}
            </p>
          ) : null}
        </div>
      ) : null}

      {fieldError ? (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {fieldError}
        </p>
      ) : null}

      {mayBeBroken ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          This link may be broken. It does not match a page or category in
          your store.
        </p>
      ) : null}
    </div>
  );
}
