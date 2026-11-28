import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const requireWeb = createRequire(
  path.join(REPO_ROOT, "apps", "web", "package.json"),
);
const { chromium } = requireWeb("@playwright/test");

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(
  /\/+$/,
  "",
);
const ADMIN_TOKEN = process.env.ADMIN_SESSION_TOKEN || "";
const CLOSED_STORE = process.env.EXPECT_CLOSED === "1";
const WIDTHS = [360, 390, 1280];
const HEIGHT = 900;
const SITE_NAME = "Zayn Furnishings";
const BRAND = "Zayn Furnishings";

const FIXED_PUBLIC_PATHS = [
  "/",
  "/about",
  "/contact",
  "/faq",
  "/delivery",
  "/returns",
  "/privacy",
  "/terms",
  "/accessibility",
  "/new",
  "/sale",
  "/search",
  "/search?q=sofa",
  "/cart",
  "/checkout",
  "/account",
  "/order/ZF-000000",
  "/404",
];

const NOINDEX_PATHS = [
  "/about",
  "/contact",
  "/faq",
  "/delivery",
  "/returns",
  "/privacy",
  "/terms",
  "/accessibility",
  "/search",
  "/search?q=sofa",
  "/cart",
  "/checkout",
  "/account",
  "/order/ZF-000000",
  "/404",
];

const ADMIN_PATHS = ["/admin", "/admin/products", "/admin/settings"];

const FORBIDDEN_TEXT = [
  "design-preview",
  "SAMPLE",
  "example.com",
  "@zaynfurnishings.example",
  "Easy returns",
  "white-glove",
  "lorem",
  "555-",
];

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
  console.log(`FAIL ${message}`);
}

function pass(message) {
  console.log(`PASS ${message}`);
}

function warn(message) {
  warnings.push(message);
  console.log(`WARN ${message}`);
}

function unique(values) {
  return Array.from(new Set(values));
}

function pathOf(url) {
  try {
    const parsed = new URL(url, BASE_URL);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

async function fetchText(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "zayn-launch-basics/1.0" },
    });

    return {
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      body: await response.text(),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function sitemapRoutes() {
  const result = await fetchText(`${BASE_URL}/sitemap.xml`);
  const routes = [...result.body.matchAll(/<loc>(.*?)<\/loc>/g)]
    .map((match) => pathOf(match[1].replaceAll("&amp;", "&")))
    .filter(Boolean);

  return { result, routes: unique(routes) };
}

async function readMetadata(page, pathName) {
  const response = await page.goto(`${BASE_URL}${pathName}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });

  return page.evaluate(() => {
    const meta = (name) =>
      document
        .querySelector(`meta[name="${name}"]`)
        ?.getAttribute("content") || "";
    const property = (name) =>
      document
        .querySelector(`meta[property="${name}"]`)
        ?.getAttribute("content") || "";
    const canonical =
      document.querySelector('link[rel="canonical"]')?.getAttribute("href") ||
      "";
    const iconHrefs = Array.from(
      document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]'),
    ).map((link) => link.getAttribute("href") || "");
    const appleHrefs = Array.from(
      document.querySelectorAll('link[rel="apple-touch-icon"]'),
    ).map((link) => link.getAttribute("href") || "");

    return {
      status: undefined,
      title: document.title,
      description: meta("description"),
      robots: `${meta("robots")} ${meta("googlebot")}`.trim(),
      canonical,
      h1Count: document.querySelectorAll("h1").length,
      ogTitle: property("og:title"),
      ogDescription: property("og:description"),
      ogSiteName: property("og:site_name"),
      ogImage: property("og:image"),
      twitterCard: meta("twitter:card"),
      iconHrefs,
      appleHrefs,
      bodyText: document.body?.innerText || "",
    };
  }).then((data) => ({
    ...data,
    status: response?.status() ?? null,
  }));
}

async function checkIcons() {
  const expected = [
    ["/favicon.ico", ["image/x-icon", "image/vnd.microsoft.icon"]],
    ["/icon.svg", ["image/svg+xml"]],
    ["/icon.png", ["image/png"]],
    ["/apple-icon.png", ["image/png"]],
  ];

  for (const [iconPath, expectedTypes] of expected) {
    const result = await fetchText(`${BASE_URL}${iconPath}`);

    if (result.status !== 200) {
      fail(`${iconPath} returned ${result.status}`);
      continue;
    }

    const type = result.contentType.split(";")[0].trim().toLowerCase();

    if (!expectedTypes.includes(type)) {
      fail(
        `${iconPath} content type is ${type}, expected ${expectedTypes.join(" or ")}`,
      );
    } else {
      pass(`${iconPath} returned 200 ${type}`);
    }
  }
}

async function checkClosedStore(browser) {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1280, height: HEIGHT },
  });
  const page = await context.newPage();
  const meta = await readMetadata(page, "/");

  if (meta.status !== 200) {
    fail(`closed home returned ${meta.status}`);
  }

  if (!meta.title.includes("Coming soon")) {
    fail(`closed home title is "${meta.title}", expected Coming soon`);
  }

  if (meta.title.length > 60) {
    fail(`closed home title is ${meta.title.length} characters`);
  }

  if (!meta.title.includes(SITE_NAME)) {
    fail(`closed home title does not include the store name: "${meta.title}"`);
  }

  if (meta.h1Count !== 1) {
    fail(`closed home has ${meta.h1Count} h1 elements`);
  }

  if (!meta.robots.includes("noindex")) {
    fail("closed home is missing noindex");
  }

  if (meta.description.length < 50 || meta.description.length > 160) {
    fail(`closed home description is ${meta.description.length} characters`);
  }

  if (meta.iconHrefs.length === 0) {
    fail("closed home has no icon link");
  }

  if (meta.appleHrefs.length === 0) {
    fail("closed home has no apple-touch-icon link");
  }

  await checkIcons();
  await context.close();

  if (failures.length === 0) {
    pass("closed-store Coming soon title, h1, noindex and icons");
  }
}

async function checkOpenStore(browser) {
  const sitemap = await sitemapRoutes();

  if (sitemap.result.status !== 200) {
    fail(`/sitemap.xml returned ${sitemap.result.status}`);
  }

  if (sitemap.routes.length === 0) {
    fail("sitemap has no routes");
  }

  const sitemapFailures = failures.length;

  for (const route of sitemap.routes) {
    const result = await fetchText(`${BASE_URL}${route}`);

    if (result.status !== 200) {
      fail(`sitemap route ${route} returned ${result.status}`);
    }
  }

  if (sitemap.routes.length > 0 && failures.length === sitemapFailures) {
    pass(`all ${sitemap.routes.length} sitemap routes returned 200`);
  }

  for (const removed of ["/design-preview", "/wishlist"]) {
    const result = await fetchText(`${BASE_URL}${removed}`);

    if (result.status !== 404) {
      fail(`${removed} returned ${result.status}, expected 404`);
    } else {
      pass(`${removed} returned 404`);
    }
  }

  const staticContext = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1280, height: HEIGHT },
  });
  const staticPage = await staticContext.newPage();

  if (ADMIN_TOKEN) {
    await staticContext.addCookies([
      {
        name: "zf_admin_session",
        value: ADMIN_TOKEN,
        url: BASE_URL,
        httpOnly: true,
        sameSite: "Lax",
        secure: BASE_URL.startsWith("https://"),
      },
    ]);
  }

  const publicPaths = unique([
    ...FIXED_PUBLIC_PATHS,
    ...sitemap.routes.filter(
      (route) =>
        route.startsWith("/p/") ||
        route.startsWith("/c/") ||
        route === "/" ||
        route === "/new" ||
        route === "/sale",
    ),
  ]);

  const titles = new Map();
  const descriptions = new Map();
  let metadataFailures = 0;

  for (const route of publicPaths) {
    const meta = await readMetadata(staticPage, route);
    const routeTitle = meta.title.trim();
    const description = meta.description.trim();
    const brandCount = routeTitle.split(BRAND).length - 1;

    if (route !== "/404" && (meta.status === null || meta.status >= 400)) {
      fail(`${route} returned ${meta.status}`);
      metadataFailures += 1;
    }

    if (!routeTitle) {
      fail(`${route} has no title`);
      metadataFailures += 1;
    } else {
      if (routeTitle.length > 60) {
        fail(`${route} title is ${routeTitle.length} characters`);
        metadataFailures += 1;
      }

      if (brandCount !== 1) {
        fail(`${route} title has brand ${brandCount} times: "${routeTitle}"`);
        metadataFailures += 1;
      }

      if (titles.has(routeTitle)) {
        fail(`${route} title duplicates ${titles.get(routeTitle)}`);
        metadataFailures += 1;
      } else {
        titles.set(routeTitle, route);
      }
    }

    if (description.length < 50 || description.length > 160) {
      fail(`${route} description is ${description.length} characters`);
      metadataFailures += 1;
    }

    if (descriptions.has(description)) {
      fail(`${route} description duplicates ${descriptions.get(description)}`);
      metadataFailures += 1;
    } else {
      descriptions.set(description, route);
    }

    if (meta.h1Count !== 1) {
      fail(`${route} has ${meta.h1Count} h1 elements`);
      metadataFailures += 1;
    }

    if (!meta.canonical) {
      fail(`${route} has no canonical`);
      metadataFailures += 1;
    } else if (
      meta.canonical.includes("?") &&
      !meta.canonical.includes("page=")
    ) {
      fail(`${route} canonical contains a non-pagination query`);
      metadataFailures += 1;
    }

    if (!meta.ogTitle || !meta.ogDescription || !meta.ogSiteName) {
      fail(`${route} is missing Open Graph basics`);
      metadataFailures += 1;
    }

    if (!meta.twitterCard) {
      fail(`${route} is missing a Twitter card`);
      metadataFailures += 1;
    }

    if (NOINDEX_PATHS.includes(route) && !meta.robots.includes("noindex")) {
      fail(`${route} is missing noindex`);
      metadataFailures += 1;
    }

    if (sitemap.routes.includes(route) && meta.robots.includes("noindex")) {
      fail(`${route} is in the sitemap but is noindex`);
      metadataFailures += 1;
    }
  }

  if (publicPaths.includes("/") && sitemap.routes.includes("/")) {
    const homeMeta = await readMetadata(staticPage, "/");
    if (homeMeta.robots.includes("noindex")) {
      fail("home is noindex");
      metadataFailures += 1;
    }
  }

  for (const route of sitemap.routes.filter(
    (route) => route.startsWith("/p/"),
  )) {
    const meta = await readMetadata(staticPage, route);

    if (meta.robots.includes("noindex")) {
      fail(`product ${route} is noindex`);
      metadataFailures += 1;
    }
  }

  for (const route of sitemap.routes.filter(
    (route) => route.startsWith("/c/"),
  )) {
    const meta = await readMetadata(staticPage, route);

    if (meta.robots.includes("noindex")) {
      fail(`category ${route} is noindex`);
      metadataFailures += 1;
    }
  }

  if (ADMIN_TOKEN) {
    for (const route of ADMIN_PATHS) {
      const meta = await readMetadata(staticPage, route);

      if (!meta.robots.includes("noindex")) {
        fail(`admin route ${route} is missing noindex`);
        metadataFailures += 1;
      }
    }
  } else {
    warn("ADMIN_SESSION_TOKEN not set; admin noindex checks skipped");
  }

  if (metadataFailures === 0) {
    pass(
      `titles, descriptions, h1, canonical, OG/Twitter and robots passed on ${publicPaths.length} public routes`,
    );
  }

  const linkMeta = await readMetadata(staticPage, "/");

  if (linkMeta.iconHrefs.length === 0) {
    fail("home has no icon link");
  }

  if (linkMeta.appleHrefs.length === 0) {
    fail("home has no apple-touch-icon link");
  }

  await checkIcons();

  const forbiddenHits = new Map();

  for (const route of unique([
    ...publicPaths,
    ...sitemap.routes,
  ])) {
    const meta = await readMetadata(staticPage, route);

    for (const forbidden of FORBIDDEN_TEXT) {
      if (meta.bodyText.includes(forbidden)) {
        const existing = forbiddenHits.get(forbidden) || [];
        if (existing.length < 5) {
          existing.push(route);
        }
        forbiddenHits.set(forbidden, existing);
      }
    }
  }

  for (const [forbidden, routes] of forbiddenHits) {
    fail(
      `storefront text "${forbidden}" found on ${routes.join(", ")}${routes.length >= 5 ? " (first 5)" : ""}`,
    );
  }

  if (forbiddenHits.size === 0) {
    pass("no forbidden storefront strings found");
  }

  const footerMeta = await staticPage.evaluate(() => {
    const footer = document.querySelector("footer.zf-footer");

    if (!footer) {
      return null;
    }

    const links = Array.from(footer.querySelectorAll("a[href]")).map(
      (link) => link.getAttribute("href") || "",
    );
    const columns = Array.from(
      footer.querySelectorAll(".zf-footer__col"),
    ).map((column) => ({
      heading: column.querySelector("h3")?.textContent?.trim() || "",
      links: column.querySelectorAll("a[href]").length,
    }));
    const social = footer.querySelectorAll(".zf-footer__social").length;

    return { links, columns, social };
  });

  if (!footerMeta) {
    fail("footer not found");
  } else {
    const duplicates = footerMeta.links.filter(
      (href, index) => footerMeta.links.indexOf(href) !== index,
    );

    if (duplicates.length > 0) {
      fail(`footer has duplicate hrefs: ${unique(duplicates).join(", ")}`);
    }

    if (footerMeta.links.some((href) => !href || href === "#")) {
      fail("footer has an empty or # href");
    }

    if (footerMeta.social > 0) {
      fail("footer still has a social block");
    }

    if (
      footerMeta.columns.some(
        (column) => !column.heading || column.links === 0,
      )
    ) {
      fail("footer has an empty or orphaned column");
    }

    if (
      duplicates.length === 0 &&
      !footerMeta.links.some((href) => !href || href === "#") &&
      footerMeta.social === 0 &&
      !footerMeta.columns.some(
        (column) => !column.heading || column.links === 0,
      )
    ) {
      pass("footer links are unique and no social/empty hrefs remain");
    }
  }

  await staticContext.close();

  const liveContext = await browser.newContext({
    viewport: { width: WIDTHS[0], height: HEIGHT },
  });
  const livePage = await liveContext.newPage();
  const overflowPaths = ["/", "/cart"];
  const categoryPath = sitemap.routes.find((route) =>
    route.startsWith("/c/"),
  );
  const productPath = sitemap.routes.find((route) =>
    route.startsWith("/p/"),
  );

  if (categoryPath) {
    overflowPaths.push(categoryPath);
  }

  if (productPath) {
    overflowPaths.push(productPath);
  }

  const overflowFailures = failures.length;

  for (const route of overflowPaths) {
    for (const width of WIDTHS) {
      await livePage.setViewportSize({ width, height: HEIGHT });
      await livePage.goto(`${BASE_URL}${route}`, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      await livePage
        .waitForSelector("header.zf-nav", { timeout: 15000 })
        .catch(() => undefined);
      await livePage.evaluate(() => document.fonts?.ready).catch(() => undefined);
      await livePage.waitForTimeout(150);

      const metrics = await livePage.evaluate(() => {
        const viewportWidth = window.innerWidth;
        const offline = document.documentElement.scrollWidth > viewportWidth;
        const offenders = offline
          ? Array.from(document.querySelectorAll("body *"))
              .map((element) => ({
                element,
                rect: element.getBoundingClientRect(),
              }))
              .filter(({ element, rect }) => {
                const style = window.getComputedStyle(element);
                return (
                  style.display !== "none" &&
                  style.visibility !== "hidden" &&
                  rect.width > 0 &&
                  rect.right > viewportWidth + 1
                );
              })
              .slice(0, 3)
              .map(({ element, rect }) => ({
                tag: element.tagName.toLowerCase(),
                className:
                  typeof element.className === "string"
                    ? element.className
                    : "",
                right: Math.round(rect.right),
              }))
          : [];

        return {
          overflow: document.documentElement.scrollWidth > viewportWidth,
          offenders,
          wishlistLinks: document.querySelectorAll(
            'header a[href="/wishlist"], footer a[href="/wishlist"]',
          ).length,
        };
      });

      if (metrics.overflow) {
        fail(
          `${route} overflows at ${width}: ${JSON.stringify(metrics.offenders)}`,
        );
      }

      if (metrics.wishlistLinks > 0) {
        fail(`${route} shows a wishlist link at ${width}`);
      }
    }
  }

  if (failures.length === overflowFailures) {
    pass(`horizontal overflow and wishlist checks at ${WIDTHS.join("/")}`);
  }

  const headerFailures = failures.length;

  for (const width of WIDTHS) {
    await livePage.setViewportSize({ width, height: HEIGHT });
    await livePage.goto(`${BASE_URL}/`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await livePage
      .waitForSelector("header.zf-nav", { timeout: 15000 })
      .catch(() => undefined);
    await livePage.waitForTimeout(150);

    const header = await livePage.evaluate(() => {
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const icons = Array.from(
        document.querySelectorAll(".zf-nav__actions .zf-icon-btn"),
      )
        .filter(visible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            label: element.getAttribute("aria-label") || "",
            left: rect.left,
            right: rect.right,
          };
        })
        .sort((a, b) => a.left - b.left);
      const gaps = icons.slice(1).map((icon, index) =>
        Math.round(icon.left - icons[index].right),
      );

      return {
        icons,
        gaps,
        wishlist: document.querySelectorAll(
          'header a[href="/wishlist"]',
        ).length,
      };
    });

    if (header.wishlist > 0) {
      fail(`header shows wishlist at ${width}`);
    }

    if (header.gaps.some((gap) => gap > 8 || gap < -1)) {
      fail(`header icon gap at ${width}: ${JSON.stringify(header.gaps)}`);
    }
  }

  if (failures.length === headerFailures) {
    pass("header icon spacing is clean without wishlist at all widths");
  }

  await liveContext.close();
}

async function main() {
  const browser = await chromium.launch();

  try {
    if (CLOSED_STORE) {
      await checkClosedStore(browser);
    } else {
      await checkOpenStore(browser);
    }
  } finally {
    await browser.close();
  }

  console.log("\nLaunch basics results:");
  console.log(
    `${failures.length === 0 ? "PASS" : "FAIL"} launch basics`,
  );
  console.log(`failures: ${failures.length}`);
  console.log(`warnings: ${warnings.length}`);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
