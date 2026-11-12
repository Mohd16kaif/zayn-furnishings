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
const WIDTHS = [360, 390, 768, 1280];
const HEIGHT = 900;
const SCREENSHOT_DIR = path.resolve(process.cwd(), "docs/screenshots");
const TEST_PHONE = "2025550188";

async function fetchJson(url, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return {
      ok: response.ok,
      status: response.status,
      data: await response.json().catch(() => null),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function firstProduct() {
  const result = await fetchJson(
    `${API_URL}/api/public/products?page_size=1&in_stock=true`,
  );

  if (!result.ok) {
    return null;
  }

  return result.data?.items?.[0] ?? null;
}

async function assertServer() {
  try {
    const response = await fetch(BASE_URL, { redirect: "follow" });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function evaluatePage(page) {
  await page.keyboard.press("Tab");
  await page.waitForTimeout(60);

  return page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const header = document.querySelector("header.zf-nav");

    function isVisible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    function countVisible(selector, root = document) {
      return Array.from(root.querySelectorAll(selector)).filter(isVisible)
        .length;
    }

    const overflow = document.documentElement.scrollWidth <= viewportWidth;
    const offenders = overflow
      ? []
      : Array.from(document.querySelectorAll("body *"))
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
          .sort((a, b) => b.rect.right - a.rect.right)
          .slice(0, 5)
          .map(({ element, rect }) => ({
            tag: element.tagName.toLowerCase(),
            className:
              typeof element.className === "string" ? element.className : "",
            right: Math.round(rect.right),
          }));

    const cartLinks = header
      ? countVisible('a[href="/cart"]', header)
      : 0;
    const accountIcons = header
      ? countVisible('a[aria-label^="Account"]', header)
      : 0;
    const searchTriggers = header
      ? countVisible('button[aria-label="Search"]', header)
      : 0;

    const controls = Array.from(
      document.querySelectorAll(
        "main input:not([type=hidden]), main select, main textarea",
      ),
    ).filter(isVisible);

    const unlabeled = controls
      .filter((element) => {
        const labelledBy = element.getAttribute("aria-labelledby");
        const ariaLabel = element.getAttribute("aria-label");

        return (
          !ariaLabel &&
          !labelledBy &&
          (!element.labels || element.labels.length === 0)
        );
      })
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id,
        name: element.getAttribute("name"),
        type: element.getAttribute("type"),
      }));

    const active = document.activeElement;
    let focusVisible = false;

    if (active instanceof HTMLElement && active !== document.body) {
      const style = window.getComputedStyle(active);
      const outlineWidth = Number.parseFloat(style.outlineWidth);
      focusVisible =
        active.matches(":focus-visible") &&
        style.outlineStyle !== "none" &&
        outlineWidth >= 1;
    }

    return {
      overflow,
      offenders,
      cartLinks,
      accountIcons,
      searchTriggers,
      controlCount: controls.length,
      unlabeled,
      focusVisible,
      text: document.body.innerText.slice(0, 2000),
    };
  });
}

function pass(condition) {
  return condition ? "PASS" : "FAIL";
}

async function checkPage(page, name, width, rows) {
  await page.setViewportSize({ width, height: HEIGHT });
  await page.goto(`${BASE_URL.replace(/\/$/, "")}${name.path}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page
    .waitForSelector("header.zf-nav", { timeout: 15000 })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined);

  let ready = true;

  if (name.path === "/checkout") {
    ready = await page
      .locator("#checkout-email")
      .waitFor({ timeout: 30000 })
      .then(() => true)
      .catch(() => false);
  } else if (name.path === "/account") {
    ready = await page
      .locator("#signin-phone")
      .waitFor({ timeout: 30000 })
      .then(() => true)
      .catch(() => false);
  } else if (name.label === "order-notfound") {
    ready = await page
      .locator(".zf-notfound")
      .waitFor({ timeout: 30000 })
      .then(() => true)
      .catch(() => false);
  } else {
    ready = await page
      .locator("#signin-phone")
      .waitFor({ timeout: 30000 })
      .then(() => true)
      .catch(() => false);
  }

  if (!ready) {
    console.log(`  page did not become ready @ ${name.label} ${width}`);
  }

  await page.waitForTimeout(350);

  const result = await evaluatePage(page);

  const overflowPass = result.overflow;
  const cartPass = result.cartLinks === 1;
  const accountPass = result.accountIcons === 1;
  const searchPass = result.searchTriggers === 1;
  const labelsPass = result.unlabeled.length === 0;
  const focusPass = result.focusVisible;

  rows.push({
    page: name.label,
    width,
    overflow: pass(overflowPass),
    cart: `${pass(cartPass)}(${result.cartLinks})`,
    account: `${pass(accountPass)}(${result.accountIcons})`,
    search: `${pass(searchPass)}(${result.searchTriggers})`,
    labels: `${pass(labelsPass)}(${result.controlCount})`,
    focus: pass(focusPass),
  });

  if (!overflowPass) {
    console.log(
      `  overflow offenders @ ${name.label} ${width}: ${JSON.stringify(
        result.offenders,
      )}`,
    );
  }

  if (!labelsPass) {
    console.log(
      `  unlabeled controls @ ${name.label} ${width}: ${JSON.stringify(
        result.unlabeled,
      )}`,
    );
  }

  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name.file}-${width}.png`),
  });

  return {
    ok:
      ready &&
      overflowPass &&
      cartPass &&
      accountPass &&
      searchPass &&
      labelsPass &&
      focusPass,
    text: result.text,
  };
}

async function signIn(context) {
  try {
    const start = await context.request.post(
      `${BASE_URL}/api/auth/phone-start`,
      {
        data: { phone: TEST_PHONE },
      },
    );

    if (!start.ok()) {
      return { ok: false, reason: `phone-start ${start.status()}` };
    }

    const verify = await context.request.post(
      `${BASE_URL}/api/auth/phone-verify`,
      {
        data: { phone: TEST_PHONE, code: "123456" },
      },
    );

    return verify.ok()
      ? { ok: true }
      : { ok: false, reason: `phone-verify ${verify.status()}` };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "request failed",
    };
  }
}

async function main() {
  if (!(await assertServer())) {
    console.error(
      `Dev server not reachable at ${BASE_URL}. Start it with "pnpm dev" and re-run.`,
    );
    process.exit(2);
  }

  const product = await firstProduct();

  if (!product) {
    console.error(
      `Could not read an in-stock product from ${API_URL}/api/public/products.`,
    );
    process.exit(2);
  }

  await mkdir(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const rows = [];
  let failures = 0;

  const emptyContext = await browser.newContext({
    viewport: { width: WIDTHS[0], height: HEIGHT },
  });
  const emptyPage = await emptyContext.newPage();

  for (const width of WIDTHS) {
    await emptyPage.setViewportSize({ width, height: HEIGHT });
    await emptyPage.goto(`${BASE_URL}/checkout`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    let redirected = false;

    try {
      await emptyPage.waitForURL("**/cart", { timeout: 15000 });
      redirected = true;
    } catch {
      redirected = false;
    }

    rows.push({
      page: "checkout-empty",
      width,
      overflow: "n/a",
      cart: "n/a",
      account: "n/a",
      search: "n/a",
      labels: redirected ? "PASS" : "FAIL",
      focus: "n/a",
    });

    if (!redirected) {
      failures += 1;
      console.log(`  empty cart did not redirect @ checkout ${width}`);
    }
  }

  await emptyContext.close();

  const cartContext = await browser.newContext({
    viewport: { width: WIDTHS[0], height: HEIGHT },
  });
  await cartContext.addInitScript(
    ({ item }) => {
      window.localStorage.setItem("zf-cart", JSON.stringify([item]));
    },
    {
      item: {
        productId: product.id,
        slug: product.slug,
        name: product.name,
        price_cents: product.price_cents,
        image_url: product.primary_image_url ?? null,
        quantity: 1,
      },
    },
  );
  const cartPage = await cartContext.newPage();

  for (const width of WIDTHS) {
    const result = await checkPage(
      cartPage,
      {
        label: "checkout",
        file: "checkout-signedout",
        path: "/checkout",
      },
      width,
      rows,
    );

    if (!result.ok) {
      failures += 1;
    }
  }

  await cartContext.close();

  const accountContext = await browser.newContext({
    viewport: { width: WIDTHS[0], height: HEIGHT },
  });
  const accountPage = await accountContext.newPage();

  for (const width of WIDTHS) {
    const result = await checkPage(
      accountPage,
      {
        label: "account",
        file: "account-signedout",
        path: "/account",
      },
      width,
      rows,
    );

    if (!result.ok) {
      failures += 1;
    }
  }

  const auth = await signIn(accountContext);
  let orderAuthNote = "";

  if (auth.ok) {
    for (const width of WIDTHS) {
      const result = await checkPage(
        accountPage,
        {
          label: "order-notfound",
          file: "order-notfound",
          path: "/order/ZF-000000",
        },
        width,
        rows,
      );

      if (!result.ok) {
        failures += 1;
      }

      if (
        !result.text.toLowerCase().includes("not") &&
        !result.text.toLowerCase().includes("moved on") &&
        !result.text.toLowerCase().includes("moved")
      ) {
        failures += 1;
        console.log(
          `  order-notfound page did not show a 404-style message @ ${width}`,
        );
      }
    }
  } else {
    orderAuthNote = `order 404 checks skipped (${auth.reason})`;

    for (const width of WIDTHS) {
      const result = await checkPage(
        accountPage,
        {
          label: "order-signedout",
          file: "order-signedout",
          path: "/order/ZF-000000",
        },
        width,
        rows,
      );

      if (!result.ok) {
        failures += 1;
      }
    }

    console.log(`  ${orderAuthNote}`);
  }

  await accountContext.close();
  await browser.close();

  console.log(
    "page                width overflow      cart       account    search     labels      focus",
  );

  for (const row of rows) {
    console.log(
      `${row.page.padEnd(19)} ${String(row.width).padEnd(5)} ${row.overflow.padEnd(11)} ${row.cart.padEnd(10)} ${row.account.padEnd(10)} ${row.search.padEnd(10)} ${row.labels.padEnd(11)} ${row.focus}`,
    );
  }

  if (orderAuthNote) {
    console.log(`NOTE: ${orderAuthNote}`);
  }

  console.log(
    failures === 0
      ? "ALL CHECKOUT CHECKS PASSED"
      : `${failures} checkout check(s) failed`,
  );

  console.log(`Screenshots: ${SCREENSHOT_DIR}`);

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
