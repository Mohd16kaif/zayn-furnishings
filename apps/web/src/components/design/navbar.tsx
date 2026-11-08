"use client";

import { useEffect, useRef, useState } from "react";
import { megaColumns, navLinks } from "@/app/design-preview/preview-data";
import {
  BagIcon,
  ChevronDownIcon,
  CloseIcon,
  HeartIcon,
  MenuIcon,
  SearchIcon,
  UserIcon,
} from "./icons";
import { SmartImage } from "./smart-image";
import { ThemeToggle } from "./theme-toggle";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [megaOpen, setMegaOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const megaRef = useRef<HTMLLIElement>(null);

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
      if (megaOpen) {
        setMegaOpen(false);
        megaRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
      if (drawerOpen) {
        setDrawerOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [megaOpen, drawerOpen]);

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

  return (
    <>
      <header className={`zf-nav${scrolled ? " zf-nav--scrolled" : ""}`}>
        <div className="zf-container">
          <div className="zf-nav__inner">
            <a className="zf-wordmark" href="#top" aria-label="Zayn Furnishings home">
              <span className="zf-wordmark__top">ZAYN</span>
              <span className="zf-wordmark__bottom">Furnishings</span>
            </a>

            <nav aria-label="Main navigation">
              <ul className="zf-nav__links">
                {navLinks.map((link) =>
                  link.mega ? (
                    <li
                      key={link.label}
                      ref={megaRef}
                      className="zf-nav__item zf-mega-wrap"
                      onMouseEnter={() => setMegaOpen(true)}
                      onMouseLeave={() => setMegaOpen(false)}
                      onFocus={() => setMegaOpen(true)}
                      onBlur={(event) => {
                        if (
                          !event.currentTarget.contains(
                            event.relatedTarget as Node | null,
                          )
                        ) {
                          setMegaOpen(false);
                        }
                      }}
                    >
                      <button
                        type="button"
                        className="zf-nav__link"
                        aria-expanded={megaOpen}
                        aria-controls="living-room-menu"
                        onClick={() => setMegaOpen((open) => !open)}
                      >
                        {link.label}
                        <ChevronDownIcon className="zf-nav__chevron" />
                      </button>

                      <div
                        id="living-room-menu"
                        className={`zf-mega${megaOpen ? " is-open" : ""}`}
                      >
                        <div className="zf-mega__grid">
                          {megaColumns.map((column) => (
                            <div className="zf-mega__col" key={column.title}>
                              <h3>{column.title}</h3>
                              <ul>
                                {column.links.map((item) => (
                                  <li key={item}>
                                    <a href="#rooms" onClick={() => setMegaOpen(false)}>
                                      {item}
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}

                          <a
                            className="zf-mega__tile"
                            href="#rooms"
                            onClick={() => setMegaOpen(false)}
                          >
                            <SmartImage
                              alt="A warm living room styled with the Aldwyn collection"
                              sizes="(max-width: 1023px) 0px, 240px"
                              tone={2}
                              label="Living"
                            />
                            <span className="zf-mega__tile-label">
                              <span>The Aldwyn Collection</span>
                              <small>Shop sofas & sectionals</small>
                            </span>
                          </a>
                        </div>
                      </div>
                    </li>
                  ) : (
                    <li className="zf-nav__item" key={link.label}>
                      <a
                        className={`zf-nav__link${link.sale ? " zf-nav__link--sale" : ""}`}
                        href={link.href}
                      >
                        {link.label}
                      </a>
                    </li>
                  ),
                )}
              </ul>
            </nav>

            <div className="zf-nav__actions">
              <button
                type="button"
                className="zf-icon-btn zf-nav__action--optional"
                aria-label="Search"
              >
                <SearchIcon />
              </button>
              <button
                type="button"
                className="zf-icon-btn zf-nav__action--optional"
                aria-label="Account"
              >
                <UserIcon />
              </button>
              <button
                type="button"
                className="zf-icon-btn zf-nav__action--optional"
                aria-label="Wishlist"
              >
                <HeartIcon />
              </button>
              <button type="button" className="zf-icon-btn" aria-label="Cart, 3 items">
                <BagIcon />
                <span className="zf-icon-btn__badge" aria-hidden="true">
                  3
                </span>
              </button>
              <ThemeToggle />
              <button
                type="button"
                className="zf-icon-btn zf-nav__hamburger"
                aria-label="Open menu"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen(true)}
              >
                <MenuIcon />
              </button>
            </div>
          </div>
        </div>
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
          aria-label="Mobile navigation"
        >
          <div className="zf-drawer__top">
            <a className="zf-wordmark" href="#top" onClick={() => setDrawerOpen(false)}>
              <span className="zf-wordmark__top">ZAYN</span>
              <span className="zf-wordmark__bottom">Furnishings</span>
            </a>
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
            {navLinks.map((link) => (
              <li key={link.label}>
                <a href={link.href} onClick={() => setDrawerOpen(false)}>
                  {link.label}
                  <span aria-hidden="true">+</span>
                </a>
              </li>
            ))}
          </ul>

          <div className="zf-drawer__footer">
            Complimentary white-glove delivery over $1,999.
            <br />
            <a href="mailto:hello@zaynfurnishings.example">hello@zaynfurnishings.example</a>
          </div>
        </div>
      </div>
    </>
  );
}
