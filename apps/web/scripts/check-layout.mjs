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

async function fetchJson(url, timeoutMs = 30000) {
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
    const headerRect = header?.getBoundingClientRect() ?? null;
    const firstHeading = document.querySelector("main h1, h1");
    const headingTop = firstHeading?.getBoundingClientRect().top ?? null;
    const headingClear =
      headerRect !== null && headingTop !== null
        ? headingTop >= headerRect.bottom - 1
        : null;

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
      headingClear,
      headingTop,
      headerBottom: headerRect?.bottom ?? null,
    };
  });
}

async function evaluateDrawerAndDark(page) {
  await page.setViewportSize({ width: 390, height: HEIGHT });
  await page.goto(`${BASE_URL}/c/living-room`, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page
    .waitForSelector("header.zf-nav", { timeout: 15000 })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
  await page.waitForTimeout(250);

  await page
    .locator('header.zf-nav button[aria-label="Open menu"]')
    .click();
  await page.waitForSelector(".zf-drawer.is-open", { timeout: 10000 });
  await page.waitForTimeout(500);

  const level1 = await page.evaluate(() => {
    const panel = document.querySelector(".zf-drawer__panel");
    const rows = Array.from(
      document.querySelectorAll(".zf-drawer__links .zf-drawer__row"),
    );
    const panelRect = panel.getBoundingClientRect();

    return {
      bodyOverflow: getComputedStyle(document.body).overflow,
      panel: {
        left: panelRect.left,
        right: panelRect.right,
        width: panelRect.width,
      },
      rows: rows.map((row) => {
        const text = row.querySelector("span") ?? row;
        const rect = text.getBoundingClientRect();
        const detailRect = row.getBoundingClientRect();

        return {
          label: text.textContent?.trim().slice(0, 48),
          height: Math.round(detailRect.height),
          inside:
            rect.left >= panelRect.left - 0.5 &&
            rect.right <= panelRect.right + 0.5 &&
            row.scrollWidth <= row.clientWidth + 1,
        };
      }),
    };
  });

  await page.locator(".zf-drawer__links .zf-drawer__row").first().click();
  await page.waitForSelector(".zf-drawer.is-detail", { timeout: 10000 });
  await page.waitForTimeout(500);

  const level2 = await page.evaluate(() => {
    const panel = document.querySelector(".zf-drawer__panel");
    const links = Array.from(
      document.querySelectorAll(".zf-drawer__detail-links a"),
    );
    const panelRect = panel.getBoundingClientRect();

    return links.map((link) => {
      const rect = link.getBoundingClientRect();

      return {
        label: link.textContent?.trim().slice(0, 48),
        height: Math.round(rect.height),
        inside:
          rect.left >= panelRect.left - 0.5 &&
          rect.right <= panelRect.right + 0.5 &&
          link.scrollWidth <= link.clientWidth + 1,
      };
    });
  });

  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, "drawer-390.png"),
  });

  await page.evaluate(() => {
    document.documentElement.setAttribute("data-zf-theme", "dark");
  });
  await page.waitForTimeout(300);

  const contrast = await page.evaluate(() => {
    function parseColor(value) {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1]
        .split(",")
        .map((part) => Number.parseFloat(part.trim()));
      return {
        r: parts[0],
        g: parts[1],
        b: parts[2],
        a: parts.length > 3 ? parts[3] : 1,
      };
    }

    function composite(foreground, background) {
      const alpha = foreground.a;
      return {
        r: foreground.r * alpha + background.r * (1 - alpha),
        g: foreground.g * alpha + background.g * (1 - alpha),
        b: foreground.b * alpha + background.b * (1 - alpha),
        a: 1,
      };
    }

    function channel(value) {
      const normalized = value / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    }

    function luminance(color) {
      return (
        0.2126 * channel(color.r) +
        0.7152 * channel(color.g) +
        0.0722 * channel(color.b)
      );
    }

    function ratio(foreground, background) {
      const fg = foreground.a < 1 ? composite(foreground, background) : foreground;
      const l1 = luminance(fg);
      const l2 = luminance(background);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    const panel = document.querySelector(".zf-drawer__panel");
    const drawerText = document.querySelector(
      ".zf-drawer__detail-links a, .zf-drawer__row span",
    );
    const header = document.querySelector("header.zf-nav");
    const headerText = document.querySelector(".zf-wordmark__top");
    const wrapper = document.querySelector(".zf");
    const pageBackground = parseColor(getComputedStyle(wrapper).backgroundColor);
    const panelBackground = parseColor(getComputedStyle(panel).backgroundColor);
    const headerBackground = composite(
      parseColor(getComputedStyle(header).backgroundColor),
      pageBackground,
    );

    return {
      drawerRatio: ratio(
        parseColor(getComputedStyle(drawerText).color),
        panelBackground,
      ),
      headerRatio: ratio(
        parseColor(getComputedStyle(headerText).color),
        headerBackground,
      ),
    };
  });

  const drawerPass =
    level1.rows.length > 0 &&
    level2.length > 0 &&
    level1.rows.every((row) => row.inside) &&
    level2.every((row) => row.inside);
  const contrastPass =
    contrast.drawerRatio >= 4.5 && contrast.headerRatio >= 4.5;

  return {
    drawerPass,
    contrastPass,
    level1,
    level2,
    contrast,
  };
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
    {
      name: "admin-content",
      path: "/admin/content",
      widths: [390, 1280],
      admin: true,
    },
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
    for (const width of entry.widths ?? WIDTHS) {
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

      const adminPage = entry.admin === true;
      const overflowPass = result.overflow;
      const cartPass = adminPage ? true : result.cartLinks === 1;
      const searchPass = adminPage ? true : result.searchTriggers === 1;
      const inputsPass = adminPage ? true : result.searchInputs === 0;
      const navLinePass = adminPage
        ? true
        : width >= 1180
          ? result.navSameLine
          : true;
      const iconsPass = result.iconsInside;
      const headingRelevant =
        !adminPage &&
        (entry.path === "/c/living-room" ||
          entry.path === "/search?q=sofa") &&
        [360, 390, 430].includes(width);
      const headingPass = headingRelevant
        ? result.headingClear === true
        : true;

      if (
        !overflowPass ||
        !cartPass ||
        !searchPass ||
        !inputsPass ||
        !navLinePass ||
        !iconsPass ||
        !headingPass
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
        heading: headingRelevant ? status(headingPass) : "n/a",
        drawer: "n/a",
        contrast: "n/a",
      });

      if (headingRelevant && !headingPass) {
        console.log(
          `  heading @ ${entry.name} ${width}: h1 top ${Math.round(
            result.headingTop ?? 0,
          )} < header bottom ${Math.round(result.headerBottom ?? 0)}`,
        );
      }

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

  const drawerResult = await evaluateDrawerAndDark(page);

  if (!drawerResult.drawerPass) {
    failures += 1;
  }

  if (!drawerResult.contrastPass) {
    failures += 1;
  }

  const drawerRow = rows.find(
    (row) => row.page === "c-living-room" && row.width === 390,
  );

  if (drawerRow) {
    drawerRow.drawer = status(drawerResult.drawerPass);
    drawerRow.contrast = status(drawerResult.contrastPass);
  }

  if (!drawerResult.drawerPass) {
    console.log(
      `  drawer text @ 390: ${JSON.stringify({
        level1: drawerResult.level1.rows,
        level2: drawerResult.level2,
      })}`,
    );
  }

  if (!drawerResult.contrastPass) {
    console.log(
      `  dark contrast @ 390: ${JSON.stringify(drawerResult.contrast)}`,
    );
  }

  await browser.close();

  console.log(
    "page                 width overflow      cart       search      inputs      navline     icons       heading     drawer      contrast",
  );

  for (const row of rows) {
    console.log(
      `${row.page.padEnd(20)} ${String(row.width).padEnd(5)} ${row.overflow.padEnd(11)} ${row.cart.padEnd(10)} ${row.search.padEnd(11)} ${row.inputs.padEnd(11)} ${row.navline.padEnd(11)} ${row.icons.padEnd(11)} ${row.heading.padEnd(11)} ${row.drawer.padEnd(11)} ${row.contrast}`,
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
