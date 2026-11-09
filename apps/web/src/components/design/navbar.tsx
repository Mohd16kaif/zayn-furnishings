"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  PublicCategoryNode,
  PublicStoreSettings,
} from "@zayn/shared";
import { formatCents } from "@/lib/money";
import { useCartCount } from "./cart-provider";
import {
  BagIcon,
  ChevronDownIcon,
  CloseIcon,
  HeartIcon,
  MenuIcon,
  SearchIcon,
  UserIcon,
} from "./icons";
import { SearchCombobox } from "./search-combobox";
import { SmartImage } from "./smart-image";
import { ThemeToggle } from "./theme-toggle";
import { ZipControl } from "./zip-control";

type NavbarProps = {
  categories: PublicCategoryNode[];
  live: boolean;
  settings: PublicStoreSettings;
};

function megaId(category: PublicCategoryNode): string {
  return `zf-mega-${category.slug}`;
}

function CartIconLink({ count }: { count: number }) {
  return (
    <Link
      className="zf-icon-btn"
      href="/cart"
      aria-label={`Cart${
        count > 0
          ? `, ${count} item${count === 1 ? "" : "s"}`
          : " is empty"
      }`}
    >
      <BagIcon />
      {count > 0 ? (
        <span className="zf-icon-btn__badge" aria-hidden="true">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}

export function Navbar({ categories, live, settings }: NavbarProps) {
  const [scrolled, setScrolled] = useState(false);
  const [openMega, setOpenMega] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const cartCount = useCartCount();

  const registerTrigger = useCallback(
    (slug: string, element: HTMLButtonElement | null) => {
      triggerRefs.current.set(slug, element);
    },
    [],
  );

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 40);
    }

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      if (openMega) {
        setOpenMega(null);
        triggerRefs.current.get(openMega)?.focus();
      }

      if (drawerOpen) {
        setDrawerOpen(false);
        hamburgerRef.current?.focus();
      }

      if (mobileSearchOpen) {
        setMobileSearchOpen(false);
        searchButtonRef.current?.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openMega, drawerOpen, mobileSearchOpen]);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  function closeMobileSearch(returnFocus = true) {
    setMobileSearchOpen(false);

    if (returnFocus) {
      searchButtonRef.current?.focus();
    }
  }

  const thresholdText = formatCents(settings.free_delivery_threshold_cents);
  const phoneHref = settings.phone
    ? `tel:${settings.phone.replace(/[^\d+]/g, "")}`
    : null;

  return (
    <>
      <header className={`zf-nav${scrolled ? " zf-nav--scrolled" : ""}`}>
        <div className="zf-nav__utility">
          <div className="zf-container zf-nav__utility-inner">
            <div className="zf-nav__contact">
              {phoneHref ? (
                <a href={phoneHref}>{settings.phone}</a>
              ) : null}
              {settings.email ? (
                <a href={`mailto:${settings.email}`}>{settings.email}</a>
              ) : null}
            </div>
            <ZipControl />
          </div>
        </div>

        <div className="zf-container">
          <div className="zf-nav__inner">
            <div className="zf-nav__left">
              <button
                ref={hamburgerRef}
                type="button"
                className="zf-icon-btn zf-nav__hamburger"
                aria-label="Open menu"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen(true)}
              >
                <MenuIcon />
              </button>

              <div className="zf-nav__search-desktop">
                <SearchCombobox />
              </div>
            </div>

            <Link
              className="zf-wordmark"
              href="/"
              aria-label="Zayn Furnishings home"
            >
              <span className="zf-wordmark__top">ZAYN</span>
              <span className="zf-wordmark__bottom">Furnishings</span>
            </Link>

            <div className="zf-nav__right">
              <div className="zf-nav__actions zf-nav__actions--desktop">
                <Link
                  className="zf-icon-btn"
                  href="/account"
                  aria-label="Account"
                >
                  <UserIcon />
                </Link>
                <Link
                  className="zf-icon-btn"
                  href="/wishlist"
                  aria-label="Wishlist"
                >
                  <HeartIcon />
                </Link>
                <CartIconLink count={cartCount} />
                <ThemeToggle />
              </div>

              <div className="zf-nav__actions zf-nav__actions--mobile">
                <button
                  ref={searchButtonRef}
                  type="button"
                  className="zf-icon-btn"
                  aria-label={
                    mobileSearchOpen ? "Close search" : "Open search"
                  }
                  aria-expanded={mobileSearchOpen}
                  aria-controls={
                    mobileSearchOpen ? "zf-mobile-search" : undefined
                  }
                  onClick={() =>
                    mobileSearchOpen
                      ? closeMobileSearch(true)
                      : setMobileSearchOpen(true)
                  }
                >
                  <SearchIcon />
                </button>
                <CartIconLink count={cartCount} />
              </div>
            </div>
          </div>
        </div>

        {categories.length > 0 ? (
          <div className="zf-nav__categories-row">
            <div className="zf-container">
              <ul className="zf-nav__links">
                {categories.map((category) => (
                  <li
                    key={category.slug}
                    className="zf-nav__item zf-mega-wrap"
                    onMouseEnter={() => setOpenMega(category.slug)}
                    onMouseLeave={() => setOpenMega(null)}
                    onFocus={() => setOpenMega(category.slug)}
                    onBlur={(event) => {
                      if (
                        !event.currentTarget.contains(
                          event.relatedTarget as HTMLElement | null,
                        )
                      ) {
                        setOpenMega(null);
                      }
                    }}
                  >
                    <button
                      ref={(element) =>
                        registerTrigger(category.slug, element)
                      }
                      type="button"
                      className="zf-nav__link"
                      aria-expanded={openMega === category.slug}
                      aria-controls={megaId(category)}
                      onClick={() =>
                        setOpenMega(
                          openMega === category.slug
                            ? null
                            : category.slug,
                        )
                      }
                    >
                      {category.name}
                      <ChevronDownIcon className="zf-nav__chevron" />
                    </button>

                    <div
                      id={megaId(category)}
                      className={`zf-mega${openMega === category.slug ? " is-open" : ""}`}
                    >
                      <div className="zf-mega__grid">
                        <div className="zf-mega__col">
                          {category.children.length > 0 ? (
                            <>
                              <h3>Shop {category.name}</h3>
                              <ul>
                                {category.children.map((child) => (
                                  <li key={child.slug}>
                                    <Link
                                      href={`/c/${child.slug}`}
                                      onClick={() =>
                                        setOpenMega(null)
                                      }
                                    >
                                      {child.name}
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </>
                          ) : (
                            <h3>Shop {category.name}</h3>
                          )}
                        </div>

                        {category.image_url ? (
                          <Link
                            className="zf-mega__tile"
                            href={`/c/${category.slug}`}
                            onClick={() => setOpenMega(null)}
                          >
                            <SmartImage
                              src={category.image_url}
                              alt={`${category.name} collection`}
                              sizes="(max-width: 1023px) 0px, 240px"
                              tone={2}
                              label={category.name}
                            />
                            <span className="zf-mega__tile-label">
                              <span>{category.name}</span>
                              <small>
                                {category.product_count} item
                                {category.product_count === 1
                                  ? ""
                                  : "s"}
                              </small>
                            </span>
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {mobileSearchOpen ? (
          <div className="zf-nav__mobile-search" id="zf-mobile-search">
            <div className="zf-container">
              <SearchCombobox
                autoFocus
                onEscape={() => closeMobileSearch(true)}
                onNavigate={() => setMobileSearchOpen(false)}
              />
            </div>
          </div>
        ) : null}

        {!live ? (
          <div className="zf-api-notice" role="status">
            The catalog is a little slow right now — some menus are
            loading.
          </div>
        ) : null}
      </header>

      <div className={`zf-drawer${drawerOpen ? " is-open" : ""}`}>
        <button
          type="button"
          className="zf-drawer__scrim"
          aria-label="Close menu"
          tabIndex={drawerOpen ? 0 : -1}
          onClick={() => setDrawerOpen(false)}
        />
        <div
          className="zf-drawer__panel"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile menu"
          aria-hidden={!drawerOpen}
          inert={!drawerOpen}
        >
          <div className="zf-drawer__top">
            <Link
              className="zf-wordmark"
              href="/"
              onClick={() => setDrawerOpen(false)}
            >
              <span className="zf-wordmark__top">ZAYN</span>
              <span className="zf-wordmark__bottom">
                Furnishings
              </span>
            </Link>
            <button
              type="button"
              className="zf-icon-btn"
              aria-label="Close menu"
              onClick={() => setDrawerOpen(false)}
            >
              <CloseIcon />
            </button>
          </div>

          <ul className="zf-drawer__links">
            {categories.map((category) => (
              <li key={category.slug}>
                <Link
                  href={`/c/${category.slug}`}
                  onClick={() => setDrawerOpen(false)}
                >
                  {category.name}
                  <span aria-hidden="true">+</span>
                </Link>
                {category.children.length > 0 ? (
                  <ul className="zf-drawer__sublinks">
                    {category.children.map((child) => (
                      <li key={child.slug}>
                        <Link
                          href={`/c/${child.slug}`}
                          onClick={() => setDrawerOpen(false)}
                        >
                          {child.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}

            <li>
              <Link
                href="/search"
                onClick={() => setDrawerOpen(false)}
              >
                Search
                <span aria-hidden="true">+</span>
              </Link>
            </li>
            <li>
              <Link
                href="/account"
                onClick={() => setDrawerOpen(false)}
              >
                Account
                <span aria-hidden="true">+</span>
              </Link>
            </li>
            <li>
              <Link
                href="/wishlist"
                onClick={() => setDrawerOpen(false)}
              >
                Wishlist
                <span aria-hidden="true">+</span>
              </Link>
            </li>
          </ul>

          <div className="zf-drawer__utility">
            <ZipControl />
            <ThemeToggle />
          </div>

          <div className="zf-drawer__footer">
            {thresholdText
              ? `Free standard delivery over ${thresholdText}.`
              : null}
            <br />
            {settings.email ? (
              <a href={`mailto:${settings.email}`}>
                {settings.email}
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
