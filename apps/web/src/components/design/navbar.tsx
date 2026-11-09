"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  ArrowLeftIcon,
  ArrowRightIcon,
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
  showNewArrivals: boolean;
  showSale: boolean;
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

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Navbar({
  categories,
  live,
  settings,
  showNewArrivals,
  showSale,
}: NavbarProps) {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [openMega, setOpenMega] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerCategory, setDrawerCategory] =
    useState<PublicCategoryNode | null>(null);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const triggerRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const hoverTimerRef = useRef<number | null>(null);
  const categoriesRowRef = useRef<HTMLDivElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const drawerPanelRef = useRef<HTMLDivElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawerBackRef = useRef<HTMLButtonElement>(null);
  const drawerItemRefs = useRef(
    new Map<string, HTMLButtonElement | null>(),
  );
  const backFocusRef = useRef<string | null>(null);
  const cartCount = useCartCount();

  const registerTrigger = useCallback(
    (slug: string, element: HTMLButtonElement | null) => {
      triggerRefs.current.set(slug, element);
    },
    [],
  );

  const cancelHoverIntent = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const closeMega = useCallback(() => {
    cancelHoverIntent();
    setOpenMega(null);
  }, [cancelHoverIntent]);

  const scheduleMega = useCallback(
    (slug: string) => {
      cancelHoverIntent();
      hoverTimerRef.current = window.setTimeout(() => {
        hoverTimerRef.current = null;
        setOpenMega(slug);
      }, 120);
    },
    [cancelHoverIntent],
  );

  const closeDrawer = useCallback((returnFocus = true) => {
    setDrawerOpen(false);
    setDrawerCategory(null);
    backFocusRef.current = null;

    if (returnFocus) {
      hamburgerRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 40);
    }

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(
    () => () => {
      cancelHoverIntent();
    },
    [cancelHoverIntent],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      if (openMega) {
        closeMega();
        triggerRefs.current.get(openMega)?.focus();
      }

      if (drawerOpen) {
        closeDrawer(true);
      }

      if (mobileSearchOpen) {
        closeMobileSearch(true);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openMega, drawerOpen, mobileSearchOpen, closeMega, closeDrawer]);

  useEffect(() => {
    if (!openMega) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target;

      if (
        target instanceof Node &&
        categoriesRowRef.current?.contains(target)
      ) {
        return;
      }

      closeMega();
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openMega, closeMega]);

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

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }

    const panel = drawerPanelRef.current;

    if (!panel) {
      return;
    }

    function focusable(): HTMLElement[] {
      return Array.from(
        panel!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter(
        (element) =>
          element.offsetParent !== null &&
          !element.closest("[inert]") &&
          !element.closest('[aria-hidden="true"]') &&
          element.getAttribute("aria-hidden") !== "true",
      );
    }

    const frame = requestAnimationFrame(() => {
      const target = drawerCloseRef.current ?? focusable()[0];

      target?.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") {
        return;
      }

      const items = focusable();

      if (items.length === 0) {
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }

    if (drawerCategory) {
      const frame = requestAnimationFrame(() => {
        drawerBackRef.current?.focus();
      });

      return () => cancelAnimationFrame(frame);
    }

    const slug = backFocusRef.current;

    if (!slug) {
      return;
    }

    backFocusRef.current = null;

    const frame = requestAnimationFrame(() => {
      drawerItemRefs.current.get(slug)?.focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [drawerOpen, drawerCategory]);

  function openDrawer() {
    backFocusRef.current = null;
    setDrawerCategory(null);
    setDrawerOpen(true);
  }

  function openDrawerCategory(category: PublicCategoryNode) {
    backFocusRef.current = category.slug;
    setDrawerCategory(category);
  }

  function goBack() {
    setDrawerCategory(null);
  }

  function closeMobileSearch(returnFocus = true) {
    setMobileSearchOpen(false);

    if (returnFocus) {
      searchButtonRef.current?.focus();
    }
  }

  function handleMegaClick(category: PublicCategoryNode) {
    if (openMega === category.slug) {
      closeMega();
      router.push(`/c/${category.slug}`);
      return;
    }

    cancelHoverIntent();
    setOpenMega(category.slug);
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
                onClick={openDrawer}
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

        {categories.length > 0 || showNewArrivals || showSale ? (
          <div
            ref={categoriesRowRef}
            className="zf-nav__categories-row"
          >
            <div className="zf-container">
              <ul className="zf-nav__links">
                {categories.map((category) => {
                  const isOpen = openMega === category.slug;

                  return (
                    <li
                      key={category.slug}
                      className="zf-nav__item zf-mega-wrap"
                      onMouseEnter={() => scheduleMega(category.slug)}
                      onMouseLeave={() => {
                        cancelHoverIntent();

                        if (isOpen) {
                          setOpenMega(null);
                        }
                      }}
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
                        aria-expanded={isOpen}
                        aria-controls={megaId(category)}
                        aria-haspopup="true"
                        onClick={() => handleMegaClick(category)}
                      >
                        {category.name}
                        <ChevronDownIcon className="zf-nav__chevron" />
                      </button>

                      <div
                        id={megaId(category)}
                        className={`zf-mega${isOpen ? " is-open" : ""}`}
                        aria-hidden={!isOpen}
                        inert={!isOpen}
                      >
                        <div className="zf-container">
                          <div
                            className={`zf-mega__inner${
                              category.image_url
                                ? ""
                                : " zf-mega__inner--no-tile"
                            }`}
                          >
                            <div className="zf-mega__main">
                              <h3 className="zf-mega__title">
                                <Link
                                  className="zf-mega__shop-all"
                                  href={`/c/${category.slug}`}
                                  onClick={closeMega}
                                >
                                  Shop All {category.name}
                                  <ArrowRightIcon />
                                </Link>
                              </h3>

                              {category.children.length > 0 ? (
                                <ul
                                  className="zf-mega__cols"
                                  aria-label={`${category.name} subcategories`}
                                >
                                  {category.children.map((child) => (
                                    <li key={child.slug}>
                                      <Link
                                        href={`/c/${child.slug}`}
                                        onClick={closeMega}
                                      >
                                        {child.name}
                                      </Link>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>

                            {category.image_url ? (
                              <div className="zf-mega__tile">
                                <div className="zf-mega__tile-media">
                                  <SmartImage
                                    src={category.image_url}
                                    alt={`${category.name} collection`}
                                    sizes="(max-width: 1023px) 0px, 280px"
                                    tone={2}
                                    label={category.name}
                                  />
                                </div>
                                <div className="zf-mega__tile-body">
                                  <span className="zf-mega__tile-name">
                                    {category.name}
                                  </span>
                                  <Link
                                    className="zf-mega__tile-link"
                                    href={`/c/${category.slug}`}
                                    onClick={closeMega}
                                  >
                                    Shop now
                                    <ArrowRightIcon />
                                  </Link>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}

                {showNewArrivals ? (
                  <li className="zf-nav__item">
                    <Link
                      className="zf-nav__link"
                      href="/new"
                      onClick={closeMega}
                    >
                      New Arrivals
                    </Link>
                  </li>
                ) : null}

                {showSale ? (
                  <li className="zf-nav__item">
                    <Link
                      className="zf-nav__link zf-nav__link--sale"
                      href="/sale"
                      onClick={closeMega}
                    >
                      Sale
                    </Link>
                  </li>
                ) : null}
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

      <div
        className={`zf-drawer${drawerOpen ? " is-open" : ""}${
          drawerCategory ? " is-detail" : ""
        }`}
      >
        <button
          type="button"
          className="zf-drawer__scrim"
          aria-label="Close menu"
          tabIndex={drawerOpen ? 0 : -1}
          onClick={() => closeDrawer(true)}
        />

        <div
          ref={drawerPanelRef}
          className="zf-drawer__panel"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile menu"
          aria-hidden={!drawerOpen}
          inert={!drawerOpen}
        >
          <div className="zf-drawer__views">
            <div
              className="zf-drawer__level zf-drawer__level--list"
              inert={Boolean(drawerCategory)}
              aria-hidden={Boolean(drawerCategory)}
            >
              <div className="zf-drawer__top">
                <Link
                  className="zf-wordmark"
                  href="/"
                  onClick={() => closeDrawer(false)}
                >
                  <span className="zf-wordmark__top">ZAYN</span>
                  <span className="zf-wordmark__bottom">
                    Furnishings
                  </span>
                </Link>
                <button
                  ref={drawerCloseRef}
                  type="button"
                  className="zf-icon-btn"
                  aria-label="Close menu"
                  onClick={() => closeDrawer(true)}
                >
                  <CloseIcon />
                </button>
              </div>

              <div className="zf-drawer__scroll">
                <ul className="zf-drawer__links">
                  {categories.map((category) => (
                    <li key={category.slug}>
                      <button
                        type="button"
                        className="zf-drawer__row zf-drawer__row--drill"
                        ref={(element) => {
                          drawerItemRefs.current.set(
                            category.slug,
                            element,
                          );
                        }}
                        aria-expanded={
                          drawerCategory?.slug === category.slug
                        }
                        onClick={() => openDrawerCategory(category)}
                      >
                        <span>{category.name}</span>
                        <ChevronDownIcon className="zf-drawer__chevron" />
                      </button>
                    </li>
                  ))}

                  {showNewArrivals ? (
                    <li>
                      <Link
                        className="zf-drawer__row"
                        href="/new"
                        onClick={() => closeDrawer(false)}
                      >
                        New Arrivals
                        <ArrowRightIcon className="zf-drawer__row-icon" />
                      </Link>
                    </li>
                  ) : null}

                  {showSale ? (
                    <li>
                      <Link
                        className="zf-drawer__row zf-drawer__row--sale"
                        href="/sale"
                        onClick={() => closeDrawer(false)}
                      >
                        Sale
                        <ArrowRightIcon className="zf-drawer__row-icon" />
                      </Link>
                    </li>
                  ) : null}
                </ul>

                <ul className="zf-drawer__secondary" aria-label="More">
                  <li>
                    <Link
                      href="/search"
                      onClick={() => closeDrawer(false)}
                    >
                      Search
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/account"
                      onClick={() => closeDrawer(false)}
                    >
                      Account
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/wishlist"
                      onClick={() => closeDrawer(false)}
                    >
                      Wishlist
                    </Link>
                  </li>
                </ul>
              </div>

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

            <div
              className="zf-drawer__level zf-drawer__level--detail"
              inert={!drawerCategory}
              aria-hidden={!drawerCategory}
            >
              <div className="zf-drawer__detail-head">
                <button
                  ref={drawerBackRef}
                  type="button"
                  className="zf-icon-btn"
                  aria-label="Back to categories"
                  onClick={goBack}
                >
                  <ArrowLeftIcon />
                </button>
                <h2>{drawerCategory?.name ?? ""}</h2>
                <button
                  type="button"
                  className="zf-icon-btn"
                  aria-label="Close menu"
                  onClick={() => closeDrawer(true)}
                >
                  <CloseIcon />
                </button>
              </div>

              <div className="zf-drawer__detail-scroll">
                {drawerCategory ? (
                  <ul className="zf-drawer__detail-links">
                    <li>
                      <Link
                        href={`/c/${drawerCategory.slug}`}
                        onClick={() => closeDrawer(false)}
                      >
                        Shop All {drawerCategory.name}
                      </Link>
                    </li>
                    {drawerCategory.children.map((child) => (
                      <li key={child.slug}>
                        <Link
                          href={`/c/${child.slug}`}
                          onClick={() => closeDrawer(false)}
                        >
                          {child.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
