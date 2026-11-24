import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const requireWeb = createRequire(
  path.join(REPO_ROOT, "apps", "web", "package.json"),
);
const { chromium } = requireWeb("@playwright/test");

export function formatCents(cents) {
  const dollars = Math.floor(Math.abs(cents) / 100);
  const remainder = (Math.abs(cents) % 100).toString().padStart(2, "0");

  return `$${dollars.toLocaleString("en-US")}.${remainder}`;
}

function cookieParts(adminCookie) {
  const separator = adminCookie.indexOf("=");

  return {
    name: adminCookie.slice(0, separator),
    value: adminCookie.slice(separator + 1),
  };
}

async function storeText(browser, url) {
  const context = await browser.newContext();

  try {
    const page = await context.newPage();
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });

    if (!response || response.status() >= 500) {
      return {
        status: response?.status() ?? 0,
        text: "",
      };
    }

    return {
      status: response.status(),
      text: await page.locator("body").innerText(),
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * Changes are made through the admin API by the caller. This helper then uses
 * the real admin content UI to invoke the same revalidateStorefront server
 * action that admin saves use, and polls the storefront in fresh browser
 * contexts so browser/client caches cannot hide a stale server response.
 */
export async function runStackRevalidationChecks({
  baseUrl,
  adminCookie,
  heroTitle,
  productSlug,
  categorySlug,
  newName,
  newPriceCents,
  timeoutMs = 15_000,
}) {
  const { name, value } = cookieParts(adminCookie);
  const priceLabel = formatCents(newPriceCents);
  const browser = await chromium.launch();
  const adminContext = await browser.newContext();
  const startedAt = Date.now();
  let productOk = false;
  let categoryOk = false;

  try {
    await adminContext.addCookies([
      {
        name,
        value,
        url: baseUrl,
        httpOnly: true,
        sameSite: "Lax",
        secure: baseUrl.startsWith("https://"),
      },
    ]);

    const adminPage = await adminContext.newPage();
    await adminPage.goto(`${baseUrl}/admin/content`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await adminPage
      .getByRole("tab", { name: "Homepage banners" })
      .click();
    await adminPage
      .getByText(heroTitle, { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    const hideButton = adminPage
      .getByRole("button", { name: "Hide", exact: true })
      .first();
    await hideButton.waitFor({ state: "visible", timeout: 15_000 });
    await hideButton.click();
    await adminPage
      .getByText("Content hidden.", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });

    const deadline = startedAt + timeoutMs;

    while (Date.now() < deadline) {
      const product = await storeText(
        browser,
        `${baseUrl}/p/${productSlug}`,
      );
      productOk =
        product.status === 200 &&
        product.text.includes(newName) &&
        product.text.includes(priceLabel);

      const category = await storeText(
        browser,
        `${baseUrl}/c/${categorySlug}`,
      );
      categoryOk =
        category.status === 200 &&
        category.text.includes(newName) &&
        category.text.includes(priceLabel);

      if (productOk && categoryOk) {
        return {
          ok: true,
          elapsedMs: Date.now() - startedAt,
          priceLabel,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 750));
    }

    throw new Error(
      `Storefront did not show the new product within ${timeoutMs}ms (product=${productOk}, category=${categoryOk}).`,
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
}
