# Launch readiness audit

Date: 2026-11-27  
Scope: storefront and admin (web-only), 40 requested items, launch checklist, and a small-batch build plan.  
Method: read-only code review, production build, a Playwright site audit against two throwaway database states, and a browser-side security scan. No file under `apps/` or `packages/` was changed. No migration was added.

Raw evidence: `reports/2026-11-27-audit-raw.json` (gitignored).  
Audit command: `pnpm audit:site --label fresh` and `pnpm audit:site --label dev`. The admin session was minted into memory only and was never printed.

## 1. One-screen summary

Verdict counts:

| Area | ALREADY DONE | BUILD | SKIP | DECISION |
| --- | ---: | ---: | ---: | ---: |
| UX items U1-U20 | 4 | 9 | 7 | 0 |
| Checklist C1-C20 | 11 | 8 | 0 | 1 |
| **Total (40)** | **15** | **17** | **7** | **1** |

Data states:

- **Fresh:** migrations + category seed only. 95 routes, 285 storefront page checks, 0 products, 0 content blocks, 0 settings rows, 1 audit-only owner. The store was open because `APP_ENV=development`; production defaults to closed. No overflow, no broken internal links.
- **Dev-data clone:** the same 101 routes plus 6 SAMPLE product pages and sample home content. 303 storefront page checks. No overflow, no broken internal links. The local clone does not have the media files for the 6 SAMPLE images, so those images 404 in this environment.
- Admin: 16 checks (8 pages x 390/1280) in both runs; all returned 200, all were noindex, none overflowed, and the bulk-price panel opened without submitting.

Top 10 launch blockers:

1. **Legal, returns, delivery, accessibility, about, contact and FAQ pages are placeholders.** Several are indexable and in the sitemap. A lawyer/client must supply the text; the developer must wire it. No legal text is proposed here.
2. **Production-only rule is not met in code:** `apps/api/src/db/seed.ts` still contains SAMPLE products, sample home copy, white-glove/return claims and sample FAQs, and `apps/web/src/app/design-preview/` contains sample products and sample claims. The seed is refused when `NODE_ENV=production`, but the demo data still exists in the repository.
3. **Order creation has no client/API idempotency key.** Double-submit and network retries can create duplicate pending orders. The pay button is disabled while pending, but that does not cover a lost response or a second tab. Refunds are already idempotent.
4. **The newsletter is not wired.** It stores nothing yet tells the visitor "Thanks, we will be in touch." The wishlist icon and page are also visible while the feature does not exist.
5. **Favicon and Apple touch icon are missing.** `/favicon.ico` and `/apple-touch-icon.png` both return 404.
6. **Generic/duplicate metadata.** Nine routes use only "Zayn Furnishings" as the title, 13 routes share one global description, `/design-preview` repeats the brand, the home title is 63 chars, and the fresh home has no h1 because the hero is content-driven and empty.
7. **Mobile touch and hero layout.** Icon buttons are 38x38 (some 32x38), footer links are 14-19px tall, hero dots are 24x2, admin mobile nav links are 26px tall. At 390px the hero arrows overlap the primary hero CTA by 1600 px². Tap targets are below the requested 44px minimum on every audited page.
8. **Footer/navigation has duplicate destinations and fake social anchors.** "Our Story/Craftsmanship/Journal" all go to `/about`, four links go to `/contact`, "Care Guide/Warranty/FAQ" all go to `/faq`, and Instagram/Pinterest/Journal all point at `#footer`.
9. **Unconfirmed claims are visible.** "Easy returns" is on the fresh home; the FAQ hard-codes `hello@zaynfurnishings.example`; delivery page says "White-glove"; sample data includes warranty/returns language. These must be confirmed or removed.
10. **Production integrations and money settings are not ready.** Stripe live keys/webhook, Stripe Tax (tax is hard-coded to 0), Twilio production Verify, Resend verified domain/`EMAIL_FROM`, Apple Pay domain file, HSTS rollout, tunnel token, and an off-server restic repository are all still operator tasks. See section 5.

## 2. The 40 items

`P1` = launch-critical, `P2` = should ship before launch, `P3` = nice to have. `S/M/L` = small/medium/large effort. No migration is required unless explicitly stated.

### UX list

| ID | Item | Verdict | Priority/effort | Evidence | Owner-visible result / reason |
| --- | --- | --- | --- | --- | --- |
| U1 | Skeleton loaders (same shape as loaded state, after ~300 ms, no jump) | BUILD | P2 / M | `apps/web/src/app/(store)/c/[slug]/loading.tsx`, `p/[slug]/loading.tsx`, `components/storefront/catalog-skeleton.tsx`; `admin/(protected)/dashboard-client.tsx:196-207`; admin list pages use text such as "Loading categories..." | Skeletons exist for category and product only; they are not delayed and are not the same component tree as the loaded page. Add a shared delayed skeleton. |
| U2 | Optimistic updates for small actions with rollback, never payments | BUILD | P3 / S | `components/storefront/cart-page-client.tsx` removes locally; `admin/(protected)/content/content-client.tsx:162-180` waits for the server; no rollback helper | Cart is already instant because it is local. Admin visibility/status toggles wait. Add optimistic update plus rollback for non-payment admin toggles. |
| U3 | Command menu Cmd/Ctrl+K, only for daily-use apps | SKIP | n/a | No command/shortcut code found; only Escape handlers in dialogs and the navbar | This is an occasional-use admin and a storefront. A command menu adds discovery and maintenance cost for a non-technical owner. |
| U4 | Shortcut hints with Cmd vs Ctrl, inactive while typing | SKIP | n/a | No global shortcuts beyond Escape | Follows U3. Do not add shortcut hints until a command menu exists. |
| U5 | Undo toasts for reversible actions, 5-10 s, `role="status"`, soft delete/delayed request | BUILD | P2 / M | `components/admin/admin-toast.tsx` has a 4.5 s toast; `cart-page-client.tsx` has no undo; content/product toggles show a toast but no undo | Add undo for cart remove, content hide/show and product active/draft. Keep confirm dialogs for hard deletes and anything touching files, orders or payments. |
| U6 | Stale-while-revalidate, never for stock/balances/money | ALREADY DONE | done | `apps/web/next.config.ts:20-21`; `lib/publicApi.ts:21-23, 183-195`; `app/layout.tsx:8-10`; `adminApi` goes through the BFF with `cache: "no-store"`; checkout calls `/api/cart-validate` live | Storefront marketing/catalog uses cache tags and short revalidation. Admin and checkout are fresh. Do not add SWR to admin stock/orders/prices. Product cards can briefly show 60 s-old stock, but checkout revalidates before creating an order. |
| U7 | Speculation rules, moderate eagerness, exclude logout/data-changing links, check prefetch first | SKIP | n/a | `next.config.ts:21` already enables `partialPrefetching`; no speculation-rule code | Next partial prefetching already covers the safe static parts. Speculation rules would add exclusions and risk without a measured benefit. |
| U8 | BlurHash/ThumbHash per uploaded image, shown at exact size | BUILD | P3 / L | `apps/api/src/lib/imagePipeline.ts:64-95` writes only WebP/2000 px; `SmartImage` has no placeholder; no hash column | Requires a new nullable hash column, a hash at upload time, a backfill and `blurDataURL`/placeholder wiring. Keep for the later batch. |
| U9 | View transitions, `<300 ms`, shared names | SKIP | n/a | No `startViewTransition`/`viewTransition` use in app code; Next 16.4.5 config has no view-transition option in local types | **Unverified.** Compatibility with Cache Components/Partial Prefetching was not established. The storefront already has careful motion; do not add risk to launch. |
| U10 | Swipe-to-dismiss bottom sheets that follow the finger, keep a close button | SKIP | n/a | Mobile nav and filters are side drawers (`components/design/navbar.tsx`, `components/storefront/catalog-filters.tsx`), search is a top panel; no bottom sheet | Nothing to swipe today. If a filter bottom sheet is added later, `motion` drag can do it, or `vaul` would be a new dependency. Not needed for launch. |
| U11 | Interruptible springs, no CSS keyframes on interruptible UI, never block input | ALREADY DONE | done | `theme.css:2678-2691` disables animation/transition for reduced motion; keyframes are entrance/decorative only (`811`, `1627`, `3992`, `4034`, `4536`, `5992`); drawers use transitions; no blocking overlay | The audited animations do not block input, and reduced motion is handled globally. |
| U12 | Android predictive back | SKIP | n/a | Repo has only `apps/api` and `apps/web`; no Android project | Web-only. N/A. |
| U13 | Tap targets >=44 CSS px, 48 where space allows, no overlap | BUILD | P2 / M | `theme.css:341-348` icon buttons 38x38; `theme.css:3341-3349` hero dots 24x2; `theme.css:2495-2500` social links 14.4 px; `theme.css:2517-2531` footer links 19 px; `theme.css:1422-1427` drawer links 15 px; admin shell uses 26 px pills (`admin-shell.tsx:141`) | Every audited page has at least one small target. Raise interactive targets and add spacing without changing the editorial look. |
| U14 | `viewport-fit=cover` and `env(safe-area-inset-*)` | BUILD | P2 / S | Root `app/layout.tsx` has no `viewport` export; audit sees `width=device-width, initial-scale=1`; `theme.css:1190-1480` uses safe-area only in the drawer | Add a viewport export with `viewportFit: "cover"` and use the insets on the sticky header, sticky checkout/order summary and admin bars. |
| U15 | One-time-code autofill and SMS body ending with domain `#123456` | ALREADY DONE | done | `components/storefront/sign-in.tsx:266-273, 335-345`; `app/admin/login/login-form.tsx:205-225` use `autocomplete="one-time-code"` and numeric input mode | Client fields are ready. The SMS text is controlled by Twilio Verify, not this repository; the Verify message should end with `@<your-domain> #<code>` (for example `@zaynfurnishings.com #123456`). The admin sign-in code is an email, so it ends with the six-digit code and an expiry/ignore line instead. |
| U16 | Tabular numbers for prices, counters, timers, table columns | BUILD | P2 / S | `theme.css:2069-2088` and `4199-4219` prices are normal; audit finds prices and quantity options with `font-variant-numeric: normal` | Add `font-variant-numeric: tabular-nums` to price/total/quantity/table-number classes. |
| U17 | `text-wrap: balance` on headings/short titles and `pretty` on paragraphs | BUILD | P3 / S | `theme.css:1564, 1908` only; most headings/paragraphs have no wrap rule | Apply to the small heading/paragraph classes; do not apply to every element. |
| U18 | Continuous corners (`corner-shape: squircle`) | SKIP | n/a | No `corner-shape`; storefront corners are mostly 2 px (`theme.css:268, 635, 790`) or pills; admin uses `rounded-lg/xl/2xl` | At 2 px the shape difference is imperceptible. Admin radii are not the storefront brand. Chromium-only support also makes this a poor launch trade. |
| U19 | Idempotency keys for payment/record-creating actions, same key on retries, button disabled while pending | BUILD | P1 / M | `components/storefront/checkout-client.tsx:451-651` has a `creatingOrder` guard and disabled button but sends no key; `app/api/orders/route.ts` forwards no key; `apps/api/src/routes/orders.ts:163-490` always inserts a new order | Add a UUID at the start of each checkout attempt, send `Idempotency-Key`, store it with a partial unique index and replay the same order response. Refunds already do this (`apps/api/src/routes/adminOrders.ts:241, 1530-1541`). |
| U20 | Safe-triangle hover menus | ALREADY DONE | done | Audit result: `menuHover.opened=true`, `before=zf-mega-living-room`, `after=zf-mega-living-room`, `closedDuringMove=false`, `switchedDuringMove=false` | A 14-step diagonal pointer move toward the panel neither closed nor switched the living-room panel. |

### Checklist

| ID | Item | Verdict | Priority/effort | Evidence | Owner-visible result / reason |
| --- | --- | --- | --- | --- | --- |
| C1 | Remove horizontal scrolling | ALREADY DONE | done | Audit: 0 overflowing pages at 360/390/1280 in both data states | No horizontal scrollbar found. |
| C2 | Find broken links | ALREADY DONE | done | Audit: 0 broken internal links; 0 external links; 1 `mailto:`; 0 `tel:`; 0 empty/hash-only hrefs | No 404/5xx internal links. The fake same-page social anchors are a C11/C7 problem, not a broken URL. |
| C3 | Add a mobile menu | ALREADY DONE | done | `components/design/navbar.tsx:1000-1160`; drawer audit: opened, body scroll locked, `aria-modal=true`, close button present, 8 rows, no row below 44px | Mobile menu works and traps focus. |
| C4 | Add a favicon | BUILD | P2 / S | No icon files in `apps/web/public`; audit `/favicon.ico=404`, `/apple-touch-icon.png=404`; no icon metadata | Add a real brand mark in both sizes and return 200. |
| C5 | Fix page titles | BUILD | P2 / S | 9 routes title "Zayn Furnishings"; `/design-preview` is double-branded; home is 63 chars; fresh home has h1=0; checkout h1=0 | Unique titles, brand once, under 60 chars, and a real h1 per page. |
| C6 | Add meta descriptions | BUILD | P2 / S | 13 routes share `"Quiet luxury for the American home. Furniture made to be lived in."`; search/page share one; home is 169 chars; `/cart` 40, `/search` 36, five categories <50 | Write page-specific descriptions in the 50-160 char range. |
| C7 | Fix footer links | BUILD | P2 / S | `footer.tsx:29-48` duplicates destinations; `footer.tsx:115-118` fake social links to `#footer` | Make each label honest: keep a real target or remove it. Do not promise a Journal/Warranty page that is not there. |
| C8 | Add a custom 404 page | ALREADY DONE | done | `app/(store)/not-found.tsx`, `app/(store)/404/page.tsx`, `components/storefront/store-not-found.tsx`; audit `/404` returns 404 with the custom screen | Works. |
| C9 | Fix the copyright year | ALREADY DONE | done | `footer.tsx:15-23, 177` uses the current year after hydration; audit shows 2026 | Dynamic year works. The server-rendered fallback is blank for one frame; acceptable. |
| C10 | Compress images | BUILD | P3 / S | `apps/web/public/images/home/room-bedroom.jpg` 475 KB, `hero-1.jpg` 338 KB, `hero-2.jpg` 303 KB; Next serves optimized WebP when `next/image` is used, and audit saw 0 images over 300 KB served | Compress the three source originals; runtime optimization already protects visitors. |
| C11 | Fix broken buttons | BUILD | P2 / M | Newsletter is fake (`footer.tsx:62-68, 170`); wishlist icon/drawer link go to placeholder (`navbar.tsx:673-676, 1095-1098`); social anchors do nothing; admin "Deliveries/Customers" are "Coming soon" (`admin-shell.tsx:85-103, 155-169`) | Hide or wire the newsletter and wishlist; remove fake social links; keep "Coming soon" only where the owner cannot mistake it for a working feature. |
| C12 | Add success messages | ALREADY DONE | done | Checkout order confirmation, sign-in, admin login, product/category/content/delivery/settings forms, price apply, refund all render success feedback | Existing real forms have success feedback. The false newsletter success is tracked in C11. |
| C13 | Add error messages | ALREADY DONE | done | Checkout, sign-in, admin login, admin CRUD forms and refund dialog render `role="alert"`/field errors; network fallbacks exist | Existing real forms have error feedback. |
| C14 | Remove placeholder text | DECISION | P1 / client + M code | Placeholder pages: `app/(store)/about`, `accessibility`, `contact`, `delivery`, `faq`, `privacy`, `returns`, `terms`, `wishlist`; `apps/api/src/db/seed.ts:62-172, 314-435`; `app/design-preview/preview-data.ts:87-191`; home `Easy returns` copy at `app/(store)/page.tsx:187-191` | Ask the client/lawyer for real copy and confirm or remove delivery/return/warranty claims. Then replace placeholders and remove SAMPLE data from code. No legal text is proposed here. |
| C15 | Remove unused navigation | BUILD | P2 / S | `footer.tsx:29-48` (duplicate company/care destinations); fake social block `115-118`; wishlist navigation | Same finding as C7. Remove/merge unused labels; do not keep dead-end editorial links. |
| C16 | Fix mobile overflow | ALREADY DONE | done | Audit: 0 overflow at 360 and 390 across all 101 dev routes/95 fresh routes | Works. |
| C17 | Make the logo clickable | ALREADY DONE | done | `navbar.tsx:638-645`; footer logo `footer.tsx:99-103` | Works. |
| C18 | Make the phone number clickable (`tel:`) | ALREADY DONE | done | `navbar.tsx:592-596, 1104-1111`; footer `footer.tsx:126-133`; ComingSoon `coming-soon.tsx:21-27`; audit shows 0 tel links because no phone is configured | Code is ready; the client must supply the real public phone. |
| C19 | Make the email clickable (`mailto:`) | BUILD | P2 / S | Footer conditional `mailto:` works; FAQ hard-codes `hello@zaynfurnishings.example` at `components/storefront/faq.tsx:38`; contact page has no email/phone/form | Use `settings.email`, delete the example address, and put real contact methods on `/contact`. |
| C20 | Make every page mobile optimized | ALREADY DONE | done | All routes returned PASS at 360, 390 and 1280 for overflow (table in section 3); admin 390/1280 also pass | Layout fits. Tap targets and safe-area are separate U13/U14 fixes. |

## 3. Page-by-page audit findings

### Run comparison

| | Fresh database | Dev-data clone |
| --- | --- | --- |
| Routes audited | 95 | 101 |
| Storefront checks (3 widths) | 285 | 303 |
| Admin checks (2 widths) | 16 | 16 |
| Products | 0 | 6 SAMPLE products |
| Content blocks | 0 | 16 sample blocks |
| Home h1 | **0** (hero has no content) | 1 |
| Home hero/rooms/featured/craft | absent | present |
| `/new` and `/sale` | honest empty states | populated |
| Product pages | none | 6 SAMPLE pages |
| Broken internal links | 0 | 0 |
| Horizontal overflow | 0 pages | 0 pages |
| Favicon / Apple icon | 404 / 404 | 404 / 404 |
| Admin noindex | all 8 pages | all 8 pages |

The fresh home is honest but very sparse: it renders the trust strip, philosophy statement and footer, with no h1 and no call to action. It has no placeholder words, but it also has no storefront content. Production starts with `store_open=false`; in that state visitors see the Coming soon screen instead of this empty home. A visitor only sees the sparse home if the owner opens the store before adding content.

The dev home is representative of the intended look but is sample data: SAMPLE product names, sample FAQ/delivery/returns copy and sample claims. Those images 404 locally because the clone has no media files. The dev data must never be copied to production.

### Storefront routes and widths

`P` means no horizontal overflow at that width. This is the C20 evidence for every route.

| Route | 360 | 390 | 1280 | Flags |
| --- | --- | --- | --- | --- |
| `/` | P | P | P | title=63 |
| `/404` | P | P | P | no-canonical no-og |
| `/about` | P | P | P | no-canonical no-og |
| `/accessibility` | P | P | P | no-canonical no-og |
| `/account` | P | P | P | no-canonical no-og |
| `/c/accent-chairs` | P | P | P | OK |
| `/c/adjustable-bases` | P | P | P | OK |
| `/c/area-rugs` | P | P | P | OK |
| `/c/baby-and-kids` | P | P | P | OK |
| `/c/baby-and-toddler-gear` | P | P | P | OK |
| `/c/bar-furniture` | P | P | P | OK |
| `/c/bar-stools` | P | P | P | OK |
| `/c/bath` | P | P | P | OK |
| `/c/bedding` | P | P | P | OK |
| `/c/bedroom` | P | P | P | OK |
| `/c/bedroom-sets` | P | P | P | OK |
| `/c/bedroom-storage` | P | P | P | OK |
| `/c/bedroom-vanities` | P | P | P | OK |
| `/c/beds` | P | P | P | OK |
| `/c/bookcases` | P | P | P | OK |
| `/c/buffets-and-sideboards` | P | P | P | OK |
| `/c/coffee-tables` | P | P | P | OK |
| `/c/desks` | P | P | P | OK |
| `/c/dining-benches` | P | P | P | OK |
| `/c/dining-chairs` | P | P | P | OK |
| `/c/dining-room` | P | P | P | OK |
| `/c/dining-sets` | P | P | P | OK |
| `/c/dining-tables` | P | P | P | OK |
| `/c/dressers` | P | P | P | OK |
| `/c/end-tables` | P | P | P | OK |
| `/c/extendable-tables` | P | P | P | OK |
| `/c/full-mattresses` | P | P | P | OK |
| `/c/gaming-furniture` | P | P | P | OK |
| `/c/headboards` | P | P | P | OK |
| `/c/hybrid-mattresses` | P | P | P | OK |
| `/c/innerspring` | P | P | P | OK |
| `/c/kids-bedding` | P | P | P | OK |
| `/c/kids-bedroom` | P | P | P | OK |
| `/c/kids-decor` | P | P | P | OK |
| `/c/kids-furniture` | P | P | P | OK |
| `/c/king-mattresses` | P | P | P | OK |
| `/c/leather-seating` | P | P | P | OK |
| `/c/lighting` | P | P | P | OK |
| `/c/living-room` | P | P | P | OK |
| `/c/living-room-sets` | P | P | P | OK |
| `/c/loveseats` | P | P | P | OK |
| `/c/mattress-sets` | P | P | P | OK |
| `/c/mattresses` | P | P | P | OK |
| `/c/memory-foam` | P | P | P | OK |
| `/c/mirrors` | P | P | P | OK |
| `/c/modular-seating` | P | P | P | OK |
| `/c/nightstands` | P | P | P | OK |
| `/c/nursery-furniture` | P | P | P | OK |
| `/c/office` | P | P | P | OK |
| `/c/office-chairs` | P | P | P | OK |
| `/c/office-sets` | P | P | P | OK |
| `/c/office-storage` | P | P | P | OK |
| `/c/ottomans` | P | P | P | OK |
| `/c/outdoor` | P | P | P | OK |
| `/c/outdoor-accessories` | P | P | P | OK |
| `/c/outdoor-bar` | P | P | P | OK |
| `/c/outdoor-dining` | P | P | P | OK |
| `/c/outdoor-lounge` | P | P | P | OK |
| `/c/patio-heating` | P | P | P | OK |
| `/c/pillows-and-protectors` | P | P | P | OK |
| `/c/playroom` | P | P | P | OK |
| `/c/queen-mattresses` | P | P | P | OK |
| `/c/reclining-furniture` | P | P | P | OK |
| `/c/rugs-and-decor` | P | P | P | OK |
| `/c/seasonal-decor` | P | P | P | OK |
| `/c/sectionals` | P | P | P | OK |
| `/c/sleeper-sofas` | P | P | P | OK |
| `/c/sofas` | P | P | P | OK |
| `/c/throw-pillows-and-blankets` | P | P | P | title=62 |
| `/c/tv-stands` | P | P | P | OK |
| `/c/twin-mattresses` | P | P | P | OK |
| `/c/vases-and-accents` | P | P | P | OK |
| `/c/wall-art` | P | P | P | OK |
| `/c/wall-decor` | P | P | P | OK |
| `/c/window-treatments` | P | P | P | OK |
| `/cart` | P | P | P | no-canonical no-og |
| `/checkout` | P | P | P | h1=0 no-canonical no-og |
| `/contact` | P | P | P | no-canonical no-og |
| `/delivery` | P | P | P | no-canonical no-og |
| `/design-preview` | P | P | P | no-canonical no-og |
| `/faq` | P | P | P | no-canonical no-og |
| `/new` | P | P | P | OK |
| `/order/ZF-000000` | P | P | P | no-canonical no-og |
| `/p/sample-6-drawer-dresser` | P | P | P | OK |
| `/p/sample-ergonomic-office-chair` | P | P | P | OK |
| `/p/sample-oak-coffee-table` | P | P | P | OK |
| `/p/sample-queen-bed-frame` | P | P | P | OK |
| `/p/sample-willow-sofa` | P | P | P | OK |
| `/p/sample-wool-area-rug-8x10` | P | P | P | OK |
| `/privacy` | P | P | P | no-canonical no-og |
| `/returns` | P | P | P | no-canonical no-og |
| `/sale` | P | P | P | OK |
| `/search` | P | P | P | no-canonical no-og |
| `/search?q=sofa` | P | P | P | no-canonical no-og |
| `/terms` | P | P | P | no-canonical no-og |
| `/wishlist` | P | P | P | no-canonical no-og |

Admin:

| Route | 390 | 1280 | Note |
| --- | --- | --- | --- |
| `/admin/login` | P | P | h1=1, noindex |
| `/admin` | P | P | h1=2 (shell "Admin" + "Dashboard"), noindex |
| `/admin/orders` | P | P | h1=2, noindex |
| `/admin/products` | P | P | h1=2, noindex |
| `/admin/categories` | P | P | h1=2, noindex |
| `/admin/content` | P | P | h1=2, noindex |
| `/admin/delivery` | P | P | h1=2, noindex |
| `/admin/settings` | P | P | h1=2, noindex |

### Metadata, links, and structured data

- **Titles:** 0 empty, 9 generic "Zayn Furnishings", `/design-preview` is "Design Preview | Zayn Furnishings | Zayn Furnishings". Home 63 chars, one category 62. All other audited titles include the brand.
- **Descriptions:** 0 missing, but 13 routes share the global description, 2 share the search description, home is 169 chars, `/cart` 40, `/search` 36, five category descriptions are 47-49. 17 routes have no Open Graph tags (mostly static/utility pages).
- **H1:** Home is 0 on fresh data; `/checkout` is 0 in both runs (empty-cart state); all other storefront pages have 1. All admin pages have 2 because the shell adds "Admin".
- **Canonical:** present on home, sale, new, categories and products. Missing on about/contact/legal/account/cart/checkout/search/order/wishlist/404.
- **JSON-LD:** 228 fresh / 267 dev blocks parsed; 0 invalid. Home has Organization and optional FAQPage; categories and products have BreadcrumbList; products have Product.
- **Internal links:** 0 broken, 0 empty, 0 hash-only, 1 `mailto:` (the example address in the FAQ), 0 `tel:`.
- **Duplicate destinations:** `/about` (Our Story, Craftsmanship, Journal), `/contact` (Design Services, Trade Program, Careers, Contact), `/faq` (Care Guide, Warranty, FAQ), `#footer` (Instagram, Pinterest, Journal). No two full pages had identical body text; the problem is duplicate destinations and fake links.
- **Sitemap:** `/robots.txt` and `/sitemap.xml` return 200. Sitemap includes `/cart`, `/account` and `/wishlist`, which are noindex, and includes placeholder pages. `/new` and `/sale` are conditional on stock. Fix in B3.
- **Noindex:** admin is noindex on all pages; search, cart, checkout, account, order lookup, 404 and design-preview are noindex. Legal/about/contact/FAQ/wishlist are currently indexable placeholders. Staging and closed-store noindex is implemented in `robots.ts:10`, `proxy.ts:217-218`, and root metadata, but the production/staging runtime was not deployed, so the header behavior is **Unverified**.
- **Icons:** `/favicon.ico` 404, `/apple-touch-icon.png` 404. No icon links in HTML.

### Images, layout shift, and fonts

- Broken images: fresh 0; dev 6 product images 404 because the local media files are absent. No missing `alt` attributes; no naturalWidth=0 image beyond those 404s.
- Served image sizes: 0 images over 300 KB after Next optimization in this run.
- Source originals over 300 KB:
  - `apps/web/public/images/home/room-bedroom.jpg` 475,337 bytes
  - `hero-1.jpg` 337,699
  - `hero-2.jpg` 303,140
  - `room-dining.jpg` 259,157, `room-living.jpg` 245,281, `room-office.jpg` 207,144
- Layout-shift estimate: many inner pages measured about 0.104 CLS (above the 0.1 "needs improvement" line); home measured 0 in the dev run. This is an estimate from a `PerformanceObserver`, not a lab trace.
- Fonts: Cormorant Garamond + Jost are loaded through the theme font classes; no missing font request was recorded.

### Touch, viewport, and forms

- Small targets exist on every storefront page. Examples at 390: nav icon buttons 32-38 px, footer links 14-19 px, mobile drawer secondary links 15 px, hero arrows 40 px, hero dots 24x2 px, breadcrumb links 14 px. Admin mobile nav pills are 26 px tall, Logout/Refresh are 38 px.
- At 390 the home hero controls (x=202, y=688, 40x40) overlap the full-width primary CTA (x=20, y=676, 350x52) by 1600 px²; the scroll cue also overlaps the CTA/controls. This is the most serious mobile layout defect.
- Viewport meta is `width=device-width, initial-scale=1`; no `viewport-fit=cover`. Safe-area padding exists only on drawer content (`theme.css:1190-1480`). The sticky header, sticky checkout/order summary and admin header have no safe-area padding.
- Forms:
  - Newsletter: no request, no error path, false success message.
  - Contact: no form at all (placeholder page).
  - Checkout: client validation, stock/delivery errors, order creation errors, payment errors, and the order confirmation page all exist; no idempotency key.
  - Sign-in: success, invalid code, rate-limit, network and session errors exist.
  - Admin login: success status, invalid/expired code, rate-limit and network errors exist.
  - Admin CRUD: product/category/content/delivery/settings forms have field errors, alerts and success notices; delete actions use `ConfirmDialog`; refund and price apply use confirmations.

### Search, drawers, menus, and animation

- Search panel opens at 390 and 1280, stays inside the viewport, and rendered category suggestions. The direct API returned a product suggestion for "sofa", but the Playwright run observed only categories; this is likely the 30 s suggestion cache and is marked **Unverified** for the product row.
- Mobile nav: opens, locks body scroll, `aria-modal=true`, close target 38x38, 8 rows, no row under 44 px. Good.
- Mega-menu diagonal test: pass (same panel stayed open).
- Animation: 6 keyframes, 7 reduced-motion blocks plus a global reduced-motion override at `theme.css:2678-2691`. No animation blocked input. The filter drawer uses an entrance keyframe rather than a transition, but it is not interruptible; reduced motion disables it.
- Console: no JavaScript page errors. Fresh `/404` logs its intentional 404; `/checkout` aborts the Stripe script and RSC prefetch when it redirects to `/cart`; one Next warning about `scroll-behavior: smooth` and one Stripe "test over HTTP" warning. Dev logs the missing product image 404s. No unexpected console errors.

### Source text scan

The source scan found 60 "placeholder" hits (many are form placeholders and CSS class names), 17 `example.com` hits (mostly test scripts), 11 SAMPLE hits, 8 "coming soon", 6 white-glove, 5 warranty, 3 TODO, 1 `555`, and 1 default-Tailwind hit. The user-facing findings are:

- Placeholder pages and `PlaceholderPage` component.
- Footer newsletter TODO and `hello@zaynfurnishings.example`.
- `apps/api/src/db/seed.ts` SAMPLE products/content/FAQ and warranty/white-glove/returns language.
- `app/design-preview/preview-data.ts` SAMPLE products, testimonials and claims; the design preview is noindex but publicly reachable.
- Admin "Coming soon" sidebar.
- Home "Easy returns" claim with no confirmed policy.
- Form hints such as `owner@example.com`, `(555) 555-0100`, `0.00`, `10001` are input placeholders, not displayed business claims. Keep them unless the owner wants different examples.

## 4. Code-level checks

### 4.1 Checkout and money

**Order creation, today**

- Client: `apps/web/src/components/storefront/checkout-client.tsx:106, 451-651`. A `creatingOrder` state and an early return stop the same component from sending twice, and the Continue button is disabled at `1148-1153` and `1217`.
- BFF: `apps/web/src/app/api/orders/route.ts` POST forwards the body to the API. It adds no idempotency key.
- API: `apps/api/src/routes/orders.ts:163-490`. It validates products/stock/delivery/discount, calculates totals, inserts the order and order items in a transaction, then creates a Stripe PaymentIntent. The PaymentIntent uses `idempotencyKey: order-intent-${created.id}` at line 434-438. That makes PaymentIntent creation safe for one order row, but it does **not** stop a second POST from creating a second order row with a different id.
- Database: `apps/api/src/db/schema/orders.ts:25-50` has a unique order number and unique `stripe_payment_intent_id`, but no idempotency key or unique client request key. A duplicate pending order is possible.
- Result: one click is protected in one tab; a lost response, a retry, or a second tab is not. The existing stale-order cancellation script cleans up abandoned pending orders later, not immediately.

**Where an Idempotency-Key would go**

1. **Client:** create a UUID once when the user starts an order attempt (for example `useRef(crypto.randomUUID())` in `checkout-client.tsx`). Send it as `Idempotency-Key` on every retry of that same attempt. Reset it only when the cart/contact/address/discount changes, or after success. Keep the disabled pending button.
2. **Web BFF:** in `apps/web/src/app/api/orders/route.ts`, read/validate `Idempotency-Key` and forward it to the API. Do not log it.
3. **API:** in `apps/api/src/routes/orders.ts`, read the header, require a UUID, and scope it to the signed-in customer. Inside the order transaction, look up the key. If a row exists, return the stored/replayed order response (order number, client secret, totals) instead of inserting again. If not, insert with the key.
4. **Database:** add a nullable `orders.idempotency_key` and a partial unique index on `(customer_id, idempotency_key) WHERE idempotency_key IS NOT NULL`. This is additive and does not rewrite existing rows.
5. **Replay response:** store the order number and totals; the client secret can be re-read from the PaymentIntent id or stored on the order. Never put a secret in logs or analytics.
6. **Migration:** one new additive Drizzle migration:
   ```sql
   ALTER TABLE orders ADD COLUMN idempotency_key text;
   CREATE UNIQUE INDEX orders_customer_idempotency_key_unique
     ON orders (customer_id, idempotency_key)
     WHERE idempotency_key IS NOT NULL;
   ```
   No existing column or data is changed.

**Already safe**

- **Refunds:** `apps/web/src/app/admin/(protected)/orders/[orderNumber]/refund-dialog.tsx:45-60` creates a request UUID; `apps/api/src/routes/adminOrders.ts:241, 1530-1541` sends it as the Stripe idempotency key `order-refund-${order.id}-${request_id}`; the dialog disables while saving. Good. The fallback `newRequestId` returns an all-zero UUID if `crypto.randomUUID` is missing; modern browsers have it, but a loop is safer.
- **Bulk price apply:** `apps/api/src/routes/adminPriceChanges.ts:79-148` requires a signed preview token; `apps/api/src/lib/priceChanges.ts:265-323` locks the products, re-checks the token and refuses a stale apply. A repeated apply after prices change returns 409, so it is protected by optimistic concurrency rather than an `Idempotency-Key`. Keep it and add a concurrency test.
- **Webhook payment marking:** `apps/api/src/lib/markOrderPaid.ts:80-160` uses a deterministic `payments.raw_event_id` plus `onConflictDoNothing`, so the webhook and reconciliation path deduplicate. Good.
- **Price-change undo:** `adminPriceChanges.ts:195-218` is a single-use undo with audit logging. Good.

**Other record-creating POSTs**

`apps/api/src/routes/adminProducts.ts` create/duplicate/images, `adminCategories.ts` create/reorder, `adminContent.ts` create/reorder/image, `adminDeliveryZones.ts` create, `adminOrders.ts` notes/resend, and `adminCodeAuth.ts` code request all create rows without an idempotency key. Most are natural to retry or are protected by unique slugs/codes. The highest-risk remaining one is product **duplicate** (double click can make two drafts). Add a key only where a retry is likely: orders, product duplicate, and admin email resend (the notification dedupe key already exists for resend).

### 4.2 Loading states

- Category and product have `loading.tsx` skeletons (`app/(store)/c/[slug]/loading.tsx`, `p/[slug]/loading.tsx`) using `CatalogSkeleton`.
- Product skeleton is a large gallery/copy placeholder (`p/[slug]/loading.tsx`); category skeleton is `components/storefront/catalog-skeleton.tsx`.
- Admin dashboard uses an `animate-pulse` skeleton (`dashboard-client.tsx:196-207`).
- Admin list pages (orders/products/categories/content/delivery/settings) mostly show "Loading ..." text, not skeletons.
- Checkout shows "Checking your cart..." / "Your cart is empty..." text; order confirmation shows a spinner while polling.
- No 300 ms delay is implemented. Skeletons appear immediately and can flash on fast responses. There is no shared skeleton primitive, so the shapes drift from the loaded component.
- The measured CLS estimate was about 0.104 on many inner pages; this is a reason to use fixed-dimension skeletons and reserved image boxes.

### 4.3 Reversible actions vs confirm dialogs

**Good candidates for an undo toast**

- Cart remove and quantity change: local storage only, no file or money effect.
- Wishlist add/remove, once the feature exists.
- Content block hide/show (`content-client.tsx:162-180`): currently waits for the server, then shows a toast; add an undo that flips it back.
- Product active/draft toggle, once it exists in the product form; no file delete.
- Banner/announcement visibility: same pattern.
- Bulk price change already has its own history/undo screen (`price-change-panel.tsx`), not a toast.

**Must keep a confirm dialog**

- Product delete: the API deletes the row and its storage files (`apps/api/src/routes/adminProducts.ts:768+, 1259`).
- Content delete: deletes the row and image object (`adminContent.ts:623-668`).
- Category and delivery-zone delete.
- Any order status change that can cancel a payment, refund, restock, or send email.
- Price apply (money) and refund (money). Price apply already has a confirmation and an undo batch; refund has its own dialog.

Do not offer undo for orders, payments, refunds, or anything that removes files.

### 4.4 Caching

Already done:

- Home, header, footer and announcement use `"use cache"` with `cacheLife("minutes")` and public tags: `app/(store)/page.tsx:36-39`, `site-header.tsx:16-21`, `site-footer.tsx:10-14`, `announcement-bar.tsx:10-15`.
- Public API fetches carry `next.revalidate` and tags (`publicApi.ts:183-195`); API responses also send `Cache-Control: public, max-age=60, stale-while-revalidate=300` for public catalog routes.
- Admin requests go through the BFF/`adminApi` with `cache: "no-store"` and the API sets `Cache-Control: no-store` on authenticated/order routes.
- Checkout cart validation and discount preview are `cache: "no-store"`.
- Admin changes call `revalidateStorefront()` (`lib/actions/revalidateStorefront.ts`), which expires the public settings/content/categories tags and revalidates the layout.

Where SWR would be unsafe:

- Admin stock, order lists, order detail, prices, refunds, dashboard counts and audit/history. These are already no-store; do not add SWR.
- Checkout totals, delivery fees, stock and discount eligibility. These must be live at order creation; the current path already revalidates.
- Product-card `in_stock` is part of the cached public catalog. A 60 s stale display is acceptable for browsing only because the cart/checkout revalidates, but do not lengthen it, and never use cached stock to decide whether to charge.

### 4.5 Prefetch

- `apps/web/next.config.ts:20-21` has `cacheComponents: true` and `partialPrefetching: true`. Next `Link` prefetches the static part of a route by default; per-segment `prefetch` can override.
- There are no explicit `prefetch={false}` links for `/cart`, `/account`, `/checkout`, or logout. Because the cart is local and account data is personalized, the default partial prefetch is low risk but should be reviewed on the login/logout path.
- Speculation rules are not present. If added, exclude `/cart`, `/account`, `/checkout`, `/admin`, `/api/auth/logout`, and anything that changes data. Check partial prefetch first; it already provides the main benefit.

### 4.6 Images

- Upload pipeline: `apps/api/src/lib/imagePipeline.ts:64-95` rotates, resizes inside 2000x2000, converts to WebP quality 82. Content hero images use 2400 px (`adminContent.ts` image route); other content images 1200 px.
- `SmartImage` requires a `sizes` prop and passes it to `next/image` (`components/design/smart-image.tsx:10-38`).
- LCP: home hero first slide uses `priority` (`hero.tsx:134-135`); product gallery main image uses `priority` (`product-gallery.tsx:140-141`).
- The 6 public JPGs are optimized by `next/image` at request time; the source files are still large (section 3).
- BlurHash/ThumbHash would need a new nullable `blur_hash`/`thumb_hash` column on `product_images` (and content/category if desired), a hash in the upload pipeline, a backfill, and `placeholder="blur"` plus `blurDataURL` in `SmartImage`. That is additive but is a later/optional batch. `next/image` can use a BlurHash-derived data URL only after that work; there is no existing hash to reuse.

### 4.7 View transitions

No `startViewTransition`, `@view-transition`, or `<ViewTransition>` use exists in the app. Next 16.4.5 local types mention React's `ViewTransition` in Link docs, but there is no local configuration flag in `config-shared.d.ts`. Compatibility with Cache Components and Partial Prefetching was not established. Mark **Unverified** and do not ship it in this launch. If revisited, build a 300 ms transition on one shared image/heading and measure with reduced motion and slow 3G.

### 4.8 Bottom sheets

Existing web drawers:

- Mobile nav: side drawer from the right (`navbar.tsx:1000-1160`), with close button, focus trap, body scroll lock.
- Mobile filters: side drawer from the left (`catalog-filters.tsx:220-350`), with close button, focus trap, body scroll lock.
- Search: top panel under the header (`navbar.tsx:941-964`).
- Cart: a full page, not a drawer.
- Product gallery lightbox: a modal, not a bottom sheet.

None behaves like a bottom sheet. Swipe-to-dismiss is not implemented. A new bottom sheet would need a drag/gesture implementation; `motion` can do drag with spring and distance/flick thresholds, or `vaul` can be added. Adding a library is not justified now. If added, keep a visible close button and a focus trap.

### 4.9 Command menu, shortcuts, native-only items, corners

- Command menu: none. The only global key handler is Escape (`navbar.tsx:304-341`); dialogs use Escape too. No `metaKey`/`ctrlKey` handlers.
- Admin-only command menu: could be a small dialog that filters the seven nav items, but a non-technical owner will not discover Cmd/Ctrl+K and the admin is not used all day. Not worth it now.
- Android predictive back, SwiftUI continuous corners, React Native `hitSlop`, `safe-area-context`, `textContentType`: no native app exists. Repo has only `apps/api` and `apps/web`. These are N/A or web equivalents (`autocomplete`, CSS safe-area, 44 px targets).
- Corners: storefront is 2 px and pill; admin is 8-16 px (`rounded-lg/xl/2xl`). `corner-shape: squircle` is not used. At 2 px it is meaningless; admin is off-brand. Skip.

## 5. Launch readiness findings

### 5.1 What a visitor sees on a fresh database

- **Home:** trust strip ("Delivery calculated at checkout", "Easy returns", "Secure checkout"), philosophy statement, footer. No h1, no hero, no products, no CTA. Honest but empty. Production starts closed, so most visitors will see the Coming soon screen instead.
- **Category pages:** "0 pieces" and "Pieces arriving soon", with suggestions to other collections. Honest. All 75 categories are visible even when empty; the owner can deactivate unused ones.
- **Search:** "Browse the collection" and category suggestions. Honest.
- **Sale / New:** honest empty states ("No sale pieces right now", "New arrivals are on the way"). Good.
- **Cart:** honest empty state. Checkout redirects to cart when empty.
- **Wishlist:** placeholder "Save favorite pieces here - wishlists arrive with the catalog." The icon should be hidden until the feature works.
- **404:** custom, honest, with back-to-shop/search links.
- **Design preview:** sample products and sample claims, noindex but publicly reachable. Remove or protect before launch.

### 5.2 Legal, company and support copy

Real text exists for: 404. Placeholder or sample text exists for:

- Privacy Policy, Terms of Service, Returns, Delivery, Accessibility, Our Story, Contact, FAQ, Wishlist.
- SMS opt-in references Terms/Privacy, but those pages are placeholders.
- The FAQ component hard-codes `hello@zaynfurnishings.example`.
- The contact page has no phone, email or form.
- Home "Easy returns" and "Secure checkout. Encrypted, always" are unconfirmed claims.
- The delivery placeholder says "White-glove delivery across the United States".
- Accessibility placeholder says "We are building ... to WCAG 2.1 AA" but no audit has established that.

A lawyer/owner must supply privacy (including CCPA), terms of sale, returns, delivery, warranty (if any), SMS terms, accessibility statement, and any Prop 65 notice. Do not write those here. The owner must confirm whether white-glove, free delivery, financing, returns and warranty exist before any copy is published.

### 5.3 Settings and modes before real money

| Setting | Current/default | Required before launch |
| --- | --- | --- |
| `APP_ENV` | compose default is not production; docs use `staging`/`production` | `production` for the shop; `staging` for the test site. |
| `NODE_ENV` | compose web default `development` (`docker-compose.stack.yml:93`) | `production`; this also sets Secure cookies. |
| `store_open` | production default false (`packages/shared/src/appEnv.ts:30-31`); dev/staging true | Leave closed until content/legal/accounts are ready, then open deliberately. |
| Stripe live keys | docs only; no production value verified | Live secret/publishable key, live webhook secret, webhook events verified. |
| Stripe Tax | `calculateTaxCents()` always returns 0 (`packages/shared/src/pricing.ts:149-160`) | Register for tax and wire Stripe Tax or another provider before collecting tax. |
| Apple Pay | Route exists; audit 404 because `APPLE_PAY_DOMAIN_ASSOCIATION` is empty | Real association file, served 200 `text/plain` on the production domain. |
| Twilio | Production without all 3 creds is "unavailable"; dev/staging use the `123456` stub (`apps/api/src/lib/phoneVerifier.ts:19-31, 104-120`) | Production Verify service, SMS template, deliverability and STOP handling. Staging stub must never be a real customer path. |
| Resend / `EMAIL_FROM` | Missing settings log-only; docs use a placeholder sender | Verified domain, real sender, SPF/DKIM, deliverability test. |
| HSTS | Caddy starts at 300 s (`docker-compose.stack.yml:125`, `deploy/Caddyfile:18-22, 95-96`) | Raise in steps after HTTPS is verified; no preload until every subdomain is HTTPS. |
| `NEXT_PUBLIC_*` | Build args in `docker-compose.stack.yml:80-96` | Set and rebuild the web image; public values are baked in. |
| Cloudflare Tunnel | Token env only, never printed (`docker-compose.stack.yml:194-225`) | Real named tunnel token and hostname mapping. |
| restic | Default `/repo` is a local Docker volume, not off-server (`docs/BACKUPS.md`) | Off-server S3/sftp repository, password in the client's password manager with offline custody, monthly restore drill. |
| robots/noindex | Staging and closed-store disallow in code (`robots.ts:10`, `sitemap.ts:80`, `proxy.ts:217-218`) | Verify on the deployed staging origin; confirm production is indexable only when open. |
| Cookie/CCPA | No analytics found; only essential session/admin cookies | Legal review; if marketing/analytics is added, add consent and a cookie notice. Privacy policy must describe the cookies. |
| Prop 65 | No notice | Lawyer/owner decision if relevant to the products and California sales. |
| Accessibility | Placeholder statement; tap targets/hero overlap still fail | Do not claim WCAG conformance until the issues in U13/U14 and the audit are fixed and rechecked. |

### 5.4 Admin usability for a non-technical owner

- The admin shell is clear but has permanent "Coming soon" Deliveries/Customers items (`admin-shell.tsx:85-103, 155-169`). A first-time owner may think these are clickable or broken. Hide them or replace with a short "not available yet" explanation.
- The content type `promo_card` exists in the API but has no tab in `content-config.ts:11-47`. The owner cannot create/edit the promo card from admin.
- Deletes have confirmations: product/category/content/delivery. Refunds and price apply have confirmations. Store open has a confirmation. Good.
- Help text exists for settings and price changes. Product form uses terms such as SKU, slug, draft, active and archived; add one short help line per term before launch.
- Empty states exist for dashboard cards and list pages, but list loading is mostly text rather than a skeleton.
- A first-time owner can get lost between "Content", "Products", "Categories" and "Delivery zones". A one-page "start here" checklist in the admin would help (not launch-critical).
- No command menu or shortcuts; that is acceptable for an occasional-use admin.

### 5.5 Security/privacy quick scan

- Storefront/admin response headers on the local Next dev server: no CSP, HSTS, XCTO, XFO, Referrer-Policy or Permissions-Policy. The production Caddy edge adds `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` and HTTPS-only HSTS (`deploy/Caddyfile:88-96`). It intentionally omits CSP. Verify the final deployed headers; the local audit is not the production edge.
- `/media` responses (from the API) include `X-Content-Type-Options`, `Cache-Control: public, max-age=31536000, immutable`, `Cross-Origin-Resource-Policy: cross-origin`, and helmet headers including CSP and HSTS. A 404 still returned the API security headers in this run.
- Auth cookies: `HttpOnly`, `SameSite=Lax`, path `/`, `Secure` only when `NODE_ENV=production` (`authApi.ts:17-24`, `adminSessionOptions.ts:4-13`). Local dev's `Secure=false` is expected. The audit's minted admin cookie showed `httpOnly=true`, `sameSite=Lax`, `secure=false` locally.
- Admin mutations go through the same-origin BFF with Origin/Sec-Fetch-Site checks (`requestGuards.ts:32-60`) and a body limit (`adminProxy.ts`). The API is still the authorization boundary.
- Client bundle scan after the local production build: 49 `.next/static` files, 0 matches for Stripe live/test secret keys, webhook secrets, Resend keys, Postgres URLs, restic password, admin secret, storefront key, private keys, JWT-looking strings or `pk_live`. Counts only; no values were printed. Public `NEXT_PUBLIC_*` values are expected in a browser build and were not treated as secrets.
- Caddy logs drop request/response headers, bodies, query string and some fields (`deploy/Caddyfile:34-49, 98-105`). The documented assumption is no User-Agent, Cookie, Authorization, Referer, body, query string or remote port in logs. Verify the deployed log sample once.
- No analytics/tracking cookies or scripts were found. That reduces the immediate consent surface, but legal review is still required for the privacy policy and CCPA.

## 6. Launch checklist by owner

### Developer

- [ ] Replace all placeholder pages with real, owner-approved copy; remove SAMPLE data from `seed.ts` and `design-preview`; remove or protect the design preview in production.
- [ ] Add favicon/apple-touch icons; unique titles, descriptions, canonical and h1 for every indexable page; remove noindex pages from the sitemap.
- [ ] Implement order idempotency (B2) and add tests; keep refund and price-apply idempotency/concurrency tests.
- [ ] Fix 44 px tap targets, the mobile hero overlap, `viewport-fit=cover` and safe-area padding.
- [ ] Hide the wishlist until it works; wire or hide the newsletter; replace the example FAQ mailto with the configured email.
- [ ] Add delayed, shape-matched skeletons and undo toasts for reversible admin actions.
- [ ] Apply tabular numbers and text-wrap where appropriate; compress the three large source JPGs.
- [ ] Verify the production Caddy headers, Secure cookies, staging noindex, sitemap and 404 on the deployed origin.
- [ ] Run `pnpm check:encoding`, `pnpm -r lint`, `pnpm test`, `pnpm audit:site` on fresh and dev data, and the owner checklist below.

### Client / owner

- [ ] Supply the logo and icon mark, real public phone and email, business address if it should be public, and social URLs (or approve removing them).
- [ ] Supply the real catalog: names, descriptions, photos, dimensions, materials, colors, prices, stock, lead times and categories. Approve removal/deactivation of empty categories.
- [ ] Confirm the real delivery area, fee, free-delivery threshold, carrier/white-glove service, scheduling and what the customer must do.
- [ ] Confirm the real return policy, warranty (if any), cancellation policy and who pays return shipping.
- [ ] Approve the FAQ, about story, contact route, newsletter choice (hide or wire) and wishlist timing.
- [ ] Create/own Stripe, Twilio, Resend, Cloudflare and VPS accounts; decide who holds recovery codes and the restic password.
- [ ] Decide whether SMS marketing is part of launch; if yes, provide opt-in wording, STOP/HELP handling and the sending number.
- [ ] Approve the launch date and whether the store starts closed.

### Lawyer / compliance

- [ ] Privacy policy, including CCPA/CPRA rights and the cookies actually used.
- [ ] Terms of service/sale, returns, cancellation, delivery and warranty language.
- [ ] SMS terms and consent language if SMS marketing is used.
- [ ] Accessibility statement only after the accessibility issues are fixed and rechecked.
- [ ] Prop 65 decision if applicable.
- [ ] Sales-tax registration and Stripe Tax setup.

## 7. Things only the client can supply

- Logo and favicon/apple-touch source art.
- Real public phone, email, business address and social URLs.
- Catalog data and licensed photos; product dimensions, materials, colors, pricing and stock.
- Delivery area, fee structure, free-delivery threshold and service level.
- Return, warranty and cancellation policies.
- Privacy, terms, SMS, accessibility and Prop 65 text.
- Domain name and DNS control.
- Stripe account and live keys; Twilio account/Verify service; Resend account and verified domain.
- Cloudflare account/tunnel and VPS ownership.
- Off-server restic repository and password custody.
- Approval of the newsletter/wishlist decisions and the launch date.

## 8. Proposed build plan

Each batch is small, independently testable, and ordered by launch risk. Existing checks to extend: `apps/web/scripts/check-layout.mjs` (`pnpm --filter web check:layout`), `apps/web/scripts/check-checkout.mjs` (`check:checkout`), `scripts/check-price-change.mjs`, `scripts/audit-site.mjs` (`pnpm audit:site`), and `pnpm check:e2e`. New checks are named where needed.

### B1 - Launch truthfulness and client copy (P1)

Items: C14 (DECISION/client), C11, C7, C15, C19.

Work:

- Replace placeholders and sample claims with owner/lawyer copy; do not invent policies.
- Remove SAMPLE products/content from code; move any dev seed data out of production code paths.
- Hide or wire the newsletter; hide the wishlist icon/page until it works.
- Remove/merge duplicate footer labels and fake social anchors.
- Replace the example FAQ mailto with `settings.email`; add real contact methods to `/contact`.

Acceptance:

- `pnpm audit:site --label fresh` shows no user-facing lorem/SAMPLE/TODO/"coming soon"/example.com/555/white-glove/warranty/free-shipping claim except verified copy.
- Footer link destinations are unique or intentionally grouped; no `href="#footer"` social links.
- Newsletter either has a real POST with success/error states or is absent. Wishlist is absent or functional.
- Lawyer/client sign-off on policy pages.

Check: extend `audit-site.mjs` with assertions; add a small `check-content.mjs` if a static copy test is easier.

### B2 - Money safety and idempotency (P1)

Items: U19, plus regression coverage for refunds, webhook marking and bulk price apply.

Work:

- Add the client UUID, `Idempotency-Key` BFF forwarding, API lookup/replay and the additive orders column/partial unique index from section 4.1.
- Add a concurrency test: two simultaneous requests with the same key create one order and return the same order number/client secret shape.
- Keep the disabled pay/continue buttons.
- Add regression tests that the refund key and price-change preview token still reject a replay.

Acceptance:

- Same key + same customer + unchanged body returns the original order response; a changed body is rejected.
- Two concurrent requests produce one order row.
- Refund replay with the same `request_id` does not create a second refund.
- Bulk apply replay after a price change returns 409, not a second batch.

Check: new `scripts/check-idempotency.mjs` against a throwaway DB; extend `apps/web/scripts/check-checkout.mjs`; run `pnpm test` for API tests. Migration is additive only.

### B3 - SEO, icons and metadata (P2)

Items: C4, C5, C6. Also remove noindex utility pages from the sitemap and fix the fresh-home h1/empty state.

Work:

- Add favicon and apple-touch assets and metadata links.
- Give every indexable route a unique title (<=60, brand once), description (50-160) and one h1.
- Add canonicals; remove `/cart`, `/account`, `/wishlist` and placeholder legal pages from the sitemap until they are indexable and real.
- Add an empty-home fallback with a real h1 when there is no hero content.

Acceptance:

- `/favicon.ico` and `/apple-touch-icon.png` return 200.
- Audit counts: 0 missing/duplicate titles, 0 descriptions outside 50-160, 0 pages without exactly one h1 on indexable routes, 0 noindex URLs in the sitemap.
- Fresh home has one h1 and a clear "not yet stocked" message or a deliberate Coming soon state.

Check: extend `audit-site.mjs` with hard assertions; `check:layout` still passes.

### B4 - Mobile touch, safe area and hero overlap (P2)

Items: U13, U14, plus the 390 px hero overlap finding.

Work:

- Raise target boxes to at least 44x44 CSS px (48 where space) for nav icons, footer/drawer links, hero arrows/dots, breadcrumbs and admin mobile nav.
- Add `viewportFit: "cover"` and safe-area padding to the header, drawers, sticky checkout/order summary and admin bars.
- Move the hero controls away from the CTA or reduce their layout box so they do not overlap.

Acceptance:

- At 390, no interactive target under 44px on `/`, a category page, a product page, `/cart`, `/checkout`, `/account` and `/admin`.
- Hero CTA has no overlapping interactive target.
- iPhone safe-area values are respected in a device emulation; no content under the notch/home indicator.

Check: extend `apps/web/scripts/check-layout.mjs` and `audit-site.mjs`; run all widths 360/390/1280.

### B5 - Loading, optimistic updates and undo (P2)

Items: U1, U2, U5.

Work:

- Build one delayed skeleton primitive; reuse it for category/product/cart/checkout/admin list pages; reserve image boxes to avoid CLS.
- Add optimistic update + rollback for content visibility and product status; never for payments.
- Add 5-10 s `role="status"` undo toasts for cart remove, wishlist later, content hide/show and product active/draft. Keep confirm dialogs for deletes/files/orders/payments.

Acceptance:

- Skeletons only appear after ~300 ms and match the loaded layout closely.
- A forced server error rolls an optimistic toggle back with a visible message.
- Undo restores the previous state within 10 s; no undo is offered for a file/order/payment action.

Check: extend `pnpm check:e2e` / `check-checkout`; add a small UI test for the toast if needed.

### B6 - Numbers, typography and image weight (P3)

Items: U16, U17, C10.

Work:

- Add tabular numbers to prices, totals, quantity controls and admin tables.
- Apply `text-wrap: balance` to short headings and `pretty` to paragraphs.
- Compress the three public JPGs over 300 KB; keep the existing `next/image` sizes/priority behavior.

Acceptance:

- Audit finds 0 product/price/total/quantity elements without tabular numbers.
- Heading/paragraph wrap rules are present.
- All `apps/web/public` images are <=300 KB or documented.

Check: extend `audit-site.mjs` / `check:layout`; no visual regression beyond intended typography.

### B7 - Later / optional experiments (P3, not launch)

Items: U8 (BlurHash/ThumbHash, BUILD P3); U3 (command menu, SKIP); U7 (speculation rules, SKIP); U9 (view transitions, SKIP/Unverified).

Reasons: each needs a new dependency or an unverified Next capability, a backfill or a measurable performance case. None is needed to take a safe first order. Revisit after launch data and a staging benchmark. U10 (bottom sheets) and U18 (squircle) are also optional and currently skipped.

## 9. Open questions for the owner

1. Do you have a logo/favicon file and the rights to use it?
2. What public phone and email should appear on the site?
3. Which ZIPs/states do you deliver to, at what fee, and what is the free-delivery threshold (if any)?
4. What is the real return window and condition, and who pays return shipping?
5. Is there a warranty? If yes, exactly what does it cover and for how long?
6. Is white-glove delivery real, and which carrier/partner performs it?
7. Is SMS marketing part of launch? If yes, what opt-in wording and sending number should we use?
8. Which legal entity, business address, sales-tax registrations and Prop 65 position should the lawyer use?
9. Who owns the Stripe, Twilio, Resend, Cloudflare and VPS accounts, and who holds the restic password?
10. On launch day, should the store start closed or open to customers?

## 10. Uncertain / could not verify

- **View transitions:** stability and compatibility with Cache Components/Partial Prefetching in Next 16.4.5 is **Unverified**. No production implementation was attempted.
- **Staging/deployed noindex:** code paths are present, but no staging deployment was available. The local dev run is indexable because `APP_ENV=development`.
- **Apple Pay production file:** local route returns 404 because the env is empty. A real domain file was not supplied.
- **Stripe Tax / live checkout:** tax is 0 by code, and no live Stripe/Twilio/Resend account was exercised. Test-mode UI only.
- **Twilio deliverability and SMS template:** external account/service; not tested. The code never prints codes.
- **Email deliverability:** Resend domain/sender were not configured in this environment.
- **Off-server backups:** the restic repository/password were not configured; the default local volume is not off-server.
- **Caddy production headers/logs:** the Compose edge was not run for this audit; header and log behavior comes from source, not a live HTTPS deployment.
- **Product media in the dev clone:** 6 images 404 because the local clone has rows but not files. This is an environment/data finding, not proof that production uploads fail.
- **Search product suggestion row:** direct API returned a product for "sofa", but the Playwright run observed only category suggestions (likely the 30 s cache). The UI product row is **Unverified**.
- **Legal/business claims:** nothing in this document is legal advice. The client/lawyer must supply and approve all policy and business claims.

## 11. Evidence and commands

- Raw audit: `reports/2026-11-27-audit-raw.json` (fresh and dev labels, route audits, links, images, metadata, console, security headers, search/drawer/menu tests).
- Production build: `pnpm --filter web build` passed (49 `.next/static` files scanned; 0 secret-like strings).
- `pnpm check:encoding`: passed, 399 UTF-8 text files.
- `pnpm -r lint`: passed for shared, API and web.
- Dev servers were stopped before the build. Throwaway databases were dropped. The dev Postgres container remains running; no zayn stack volume was touched.
