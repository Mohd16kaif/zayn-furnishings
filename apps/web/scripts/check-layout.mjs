import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);
const API_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"
).replace(/\/$/, "");
const WIDTHS = [360, 390, 430, 768, 1024, 1180, 1280, 1440];
const HEIGHT = 800;
const SCREENSHOT_DIR = path.resolve(process.cwd(), "docs/screenshots");

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return { ok: response.ok, status: response.status, data: await response.json() };
  } finally {
    clearTimeout(timer);
  }
}

async function firstProductPath() {
  try {
    const result = await fetchJson(
      `${API_URL}/api/public/products?page_size=1`,
    );

    if (!result.ok) {
      return null;
    }

    const item = result.data?.items?.[0];

    return item?.slug ? `/p/${item.slug}` : null;
  } catch {
    return null;
  }
}

async function assertServer() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(BASE_URL, {
      signal: controller.signal,
      redirect: "follow",
    });
    return response.ok || response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function evaluateChecks(page) {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const header = document.querySelector("header.zf-nav");

    const overflow =
      document.documentElement.scrollWidth <= viewportWidth;

    let offenders = [];

    if (!overflow) {
      offenders = Array.from(document.querySelectorAll("body *"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { element, rect };
        })
        .filter(({ element, rect }) => {
          const style = window.getComputedStyle(element);
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.right > viewportWidth + 1
          );
        })
        .sort((a, b) => b.rect.right - a.rect.right)
        .slice(0, 5)
        .map(({ element, rect }) => ({
          tag: element.tagName.toLowerCase(),
          className:
            typeof element.className === "string"
              ? element.className
              : "",
          right: Math.round(rect.right),
        }));
    }

    function countVisible(selector, root = document) {
      return Array.from(root.querySelectorAll(selector)).filter(
        (element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();

          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity) !== 0 &&
            rect.width > 0 &&
            rect.height > 0
          );
        },
      ).length;
    }

    const cartLinks = header
      ? countVisible('a[href="/cart"]', header)
      : 0;
    const searchTriggers = header
      ? countVisible('button[aria-label="Search"]', header)
      : 0;
    const searchInputs = countVisible('input[type="search"]');

    const navLinks = header
      ? Array.from(
          header.querySelectorAll(
            ".zf-nav__links:not(.zf-nav__measure) > .zf-nav__item > .zf-nav__link",
          ),
        ).filter((element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0
          );
        })
      : [];

    const navTops = navLinks.map(
      (element) => element.getBoundingClientRect().top,
    );
    const navSameLine =
      navTops.length > 0 &&
      Math.max(...navTops) - Math.min(...navTops) <= 2;

    const iconRects = header
      ? Array.from(header.querySelectorAll(".zf-icon-btn"))
          .filter((element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              rect.width > 0 &&
              rect.height > 0
            );
          })
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              label: element.getAttribute("aria-label") || "(unnamed)",
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              top: Math.round(rect.top),
              bottom: Math.round(rect.bottom),
            };
          })
      : [];

    const iconsInside = iconRects.every(
      (rect) =>
        rect.left >= -1 &&
        rect.right <= viewportWidth + 1 &&
        rect.top >= -1 &&
        rect.bottom <= viewportHeight + 1,
    );

    return {
      overflow,
      offenders,
      cartLinks,
      searchTriggers,
      searchInputs,
      navSameLine,
      navLinkCount: navLinks.length,
      iconsInside,
      iconRects,
    };
  });
}

function status(condition) {
  return condition ? "PASS" : "FAIL";
}

async function main() {
  const reachable = await assertServer();

  if (!reachable) {
    console.error(
      `Dev server not reachable at ${BASE_URL}. Start it with "pnpm dev" (or "pnpm --filter web dev") and re-run.`,
    );
    process.exit(2);
  }

  const productPath = await firstProductPath();

  if (!productPath) {
    console.warn(
      `Could not read a product from ${API_URL}/api/public/products?page_size=1 — continuing without a product page.`,
    );
  }

  const pages = [
    { name: "home", path: "/" },
    { name: "c-living-room", path: "/c/living-room" },
    { name: "search-sofa", path: "/search?q=sofa" },
    { name: "cart", path: "/cart" },
  ];

  if (productPath) {
    pages.push({
      name: `p-${productPath.split("/").pop()}`,
      path: productPath,
    });
  }

  await mkdir(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: WIDTHS[0], height: HEIGHT },
  });
  const page = await context.newPage();
  let failures = 0;

  const rows = [];

  for (const entry of pages) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: HEIGHT });
      await page.goto(`${BASE_URL}${entry.path}`, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      await page
        .waitForSelector("header.zf-nav", { timeout: 15000 })
        .catch(() => undefined);
      await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
      await page.waitForTimeout(250);
      await page.evaluate(() => window.scrollTo(0, 0));

      const result = await evaluateChecks(page);

      const overflowPass = result.overflow;
      const cartPass = result.cartLinks === 1;
      const searchPass = result.searchTriggers === 1;
      const inputsPass = result.searchInputs === 0;
      const navLinePass = width >= 1180 ? result.navSameLine : true;
      const iconsPass = result.iconsInside;

      if (
        !overflowPass ||
        !cartPass ||
        !searchPass ||
        !inputsPass ||
        !navLinePass ||
        !iconsPass
      ) {
        failures += 1;
      }

      rows.push({
        page: entry.name,
        width,
        overflow: status(overflowPass),
        cart: `${status(cartPass)}(${result.cartLinks})`,
        search: `${status(searchPass)}(${result.searchTriggers})`,
        inputs: `${status(inputsPass)}(${result.searchInputs})`,
        navline:
          width >= 1180
            ? `${status(navLinePass)}(${result.navLinkCount})`
            : "n/a",
        icons: status(iconsPass),
      });

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${entry.name}-${width}.png`),
      });

      if (!overflowPass) {
        console.log(
          `  overflow offenders @ ${entry.name} ${width}: ${JSON.stringify(result.offenders)}`,
        );
      }

      if (!iconsPass) {
        console.log(
          `  icon bounds @ ${entry.name} ${width}: ${JSON.stringify(result.iconRects)}`,
        );
      }
    }
  }

  await browser.close();

  console.log(
    "page                 width overflow      cart       search      inputs      navline     icons",
  );

  for (const row of rows) {
    console.log(
      `${row.page.padEnd(20)} ${String(row.width).padEnd(5)} ${row.overflow.padEnd(11)} ${row.cart.padEnd(10)} ${row.search.padEnd(11)} ${row.inputs.padEnd(11)} ${row.navline.padEnd(11)} ${row.icons}`,
    );
  }

  console.log(
    failures === 0
      ? "ALL CHECKS PASSED"
      : `${failures} page/viewport combination(s) failed`,
  );

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
