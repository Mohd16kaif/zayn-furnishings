"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { formatCents } from "@/lib/money";
import type {
  SearchSuggestCategory,
  SearchSuggestProduct,
} from "@/lib/publicApi";
import { ArrowRightIcon, SearchIcon } from "./icons";
import { SmartImage } from "./smart-image";

type SuggestionOption =
  | { type: "product"; product: SearchSuggestProduct }
  | { type: "category"; category: SearchSuggestCategory }
  | { type: "all"; query: string };

type SearchComboboxProps = {
  className?: string;
  autoFocus?: boolean;
  onEscape?: () => void;
  onNavigate?: () => void;
  showSeeAll?: boolean;
};

type Suggestions = {
  products: SearchSuggestProduct[];
  categories: SearchSuggestCategory[];
};

function isSuggestions(value: unknown): value is Suggestions {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    Array.isArray(record.products) && Array.isArray(record.categories)
  );
}

export function SearchCombobox({
  className = "",
  autoFocus = false,
  onEscape,
  onNavigate,
  showSeeAll = false,
}: SearchComboboxProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const listId = `${baseId}-listbox`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Suggestions | null>(null);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [failed, setFailed] = useState(false);

  const trimmed = query.trim();

  useEffect(() => {
    if (!autoFocus) {
      return;
    }

    const frame = requestAnimationFrame(() => inputRef.current?.focus());

    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  useEffect(() => {
    if (trimmed.length < 2) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/search-suggest?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          throw new Error("Suggestion request failed");
        }

        const data: unknown = await response.json();

        if (!isSuggestions(data)) {
          throw new Error("Unexpected suggestion shape");
        }

        setResults(data);
        setFailed(false);
        setActiveIndex(-1);
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setResults(null);
        setFailed(true);
        setActiveIndex(-1);
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  const options = useMemo<SuggestionOption[]>(() => {
    if (!results) {
      return [];
    }

    const next: SuggestionOption[] = [];

    for (const product of results.products) {
      next.push({ type: "product", product });
    }

    for (const category of results.categories) {
      next.push({ type: "category", category });
    }

    if (!showSeeAll && next.length > 0) {
      next.push({ type: "all", query: trimmed });
    }

    return next;
  }, [results, trimmed, showSeeAll]);

  const open =
    focused &&
    !failed &&
    trimmed.length >= 2 &&
    results !== null;
  const activeId =
    open && activeIndex >= 0 && options[activeIndex]
      ? optionId(activeIndex)
      : undefined;

  useEffect(() => {
    if (!activeId) {
      return;
    }

    document.getElementById(activeId)?.scrollIntoView({
      block: "nearest",
    });
  }, [activeId]);

  function navigateTo(href: string) {
    setResults(null);
    setActiveIndex(-1);
    setFocused(false);
    onNavigate?.();
    router.push(href);
  }

  function selectOption(option: SuggestionOption) {
    if (option.type === "product") {
      navigateTo(`/p/${option.product.slug}`);
      return;
    }

    if (option.type === "category") {
      navigateTo(`/c/${option.category.slug}`);
      return;
    }

    navigateTo(`/search?q=${encodeURIComponent(option.query)}`);
  }

  function onChange(value: string) {
    setQuery(value);
    setResults(null);
    setFailed(false);
    setActiveIndex(-1);
  }

  function viewAll() {
    navigateTo(
      trimmed
        ? `/search?q=${encodeURIComponent(trimmed)}`
        : "/search",
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (open && activeIndex >= 0 && options[activeIndex]) {
      selectOption(options[activeIndex]);
      return;
    }

    navigateTo(
      trimmed
        ? `/search?q=${encodeURIComponent(trimmed)}`
        : "/search",
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      if (!open || options.length === 0) {
        return;
      }

      event.preventDefault();
      setActiveIndex((index) => (index + 1) % options.length);
      return;
    }

    if (event.key === "ArrowUp") {
      if (!open || options.length === 0) {
        return;
      }

      event.preventDefault();
      setActiveIndex((index) =>
        index <= 0 ? options.length - 1 : index - 1,
      );
      return;
    }

    if (event.key === "Enter") {
      if (open && activeIndex >= 0 && options[activeIndex]) {
        event.preventDefault();
        selectOption(options[activeIndex]);
      }

      return;
    }

    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setResults(null);
        setActiveIndex(-1);
      }

      onEscape?.();
    }
  }

  function onBlur(event: FocusEvent<HTMLFormElement>) {
    if (
      !event.currentTarget.contains(
        event.relatedTarget as Node | null,
      )
    ) {
      setFocused(false);
    }
  }

  return (
    <form
      action="/search"
      method="get"
      role="search"
      className={`zf-search-suggest ${className}`.trim()}
      onSubmit={onSubmit}
      onBlur={onBlur}
    >
      <div className="zf-search-suggest__field">
        <span className="zf-search-suggest__icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          ref={inputRef}
          type="search"
          name="q"
          value={query}
          placeholder="Search furniture"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-label="Search furniture"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeId}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
        />
      </div>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search suggestions"
          className="zf-search-suggest__list"
          onMouseDown={(event) => event.preventDefault()}
        >
          {options.length === 0 ? (
            <li
              role="option"
              aria-selected={false}
              aria-disabled="true"
              className="zf-search-suggest__empty"
            >
              No matches
            </li>
          ) : (
            options.map((option, index) => {
              const selected = index === activeIndex;

              if (option.type === "product") {
                const product = option.product;
                const onSale =
                  product.sale_price_cents !== null &&
                  product.sale_price_cents < product.price_cents;
                const effectivePrice =
                  onSale && product.sale_price_cents !== null
                    ? product.sale_price_cents
                    : product.price_cents;

                return (
                  <li
                    key={optionId(index)}
                    id={optionId(index)}
                    role="option"
                    aria-selected={selected}
                    className={`zf-search-suggest__option${selected ? " is-active" : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectOption(option)}
                  >
                    <span className="zf-search-suggest__thumb">
                      <SmartImage
                        src={product.primary_image_url ?? undefined}
                        alt=""
                        sizes="44px"
                        tone={2}
                        label=""
                      />
                    </span>
                    <span className="zf-search-suggest__body">
                      <span className="zf-search-suggest__name">
                        {product.name}
                      </span>
                      <span
                        className={`zf-search-suggest__price${onSale ? " zf-search-suggest__price--sale" : ""}`}
                      >
                        <strong>{formatCents(effectivePrice)}</strong>
                        {onSale ? (
                          <s>{formatCents(product.price_cents)}</s>
                        ) : null}
                      </span>
                    </span>
                  </li>
                );
              }

              if (option.type === "category") {
                return (
                  <li
                    key={optionId(index)}
                    id={optionId(index)}
                    role="option"
                    aria-selected={selected}
                    className={`zf-search-suggest__option zf-search-suggest__option--category${selected ? " is-active" : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectOption(option)}
                  >
                    <span className="zf-search-suggest__kind">
                      Category
                    </span>
                    <span className="zf-search-suggest__name">
                      {option.category.name}
                    </span>
                  </li>
                );
              }

              return (
                <li
                  key={optionId(index)}
                  id={optionId(index)}
                  role="option"
                  aria-selected={selected}
                  className={`zf-search-suggest__option zf-search-suggest__option--all${selected ? " is-active" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectOption(option)}
                >
                  <span className="zf-search-suggest__all">
                    See all results for &ldquo;{trimmed}&rdquo;
                  </span>
                </li>
              );
            })
          )}
        </ul>
      ) : null}

      {showSeeAll && trimmed.length > 0 ? (
        <div className="zf-search-suggest__see-all">
          <button type="button" onClick={viewAll}>
            See all results
            <ArrowRightIcon />
          </button>
        </div>
      ) : null}
    </form>
  );
}
