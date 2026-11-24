import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const requireWeb = createRequire(
  path.join(REPO_ROOT, "apps", "web", "package.json"),
);
const { chromium } = requireWeb("@playwright/test");

async function settle(page, ms = 3_000) {
  await page.waitForTimeout(ms);
}

async function imageInfo(page, selector) {
  return page.evaluate((value) => {
    const element = document.querySelector(value);

    if (!(element instanceof HTMLImageElement)) {
      return { exists: false, naturalWidth: 0, currentSrc: "" };
    }

    return {
      exists: true,
      naturalWidth: element.naturalWidth,
      currentSrc: element.currentSrc,
    };
  }, selector);
}

async function placeholderCount(page, selector) {
  return page.locator(`${selector} .zf-photo__placeholder`).count();
}

async function assertRealImage(
  check,
  page,
  name,
  containerSelector,
  imageSelector,
) {
  const info = await imageInfo(page, imageSelector);
  const placeholders = await placeholderCount(page, containerSelector);

  check(
    name,
    info.exists && info.naturalWidth > 0 && placeholders === 0,
    `exists=${info.exists}, naturalWidth=${info.naturalWidth}, placeholders=${placeholders}`,
  );
}

export async function runStackImageChecks({
  baseUrl,
  adminCookie,
  productSlug,
  categorySlug,
  productName,
}) {
  const cookieSeparator = adminCookie.indexOf("=");
  const cookieName = adminCookie.slice(0, cookieSeparator);
  const cookieValue = adminCookie.slice(cookieSeparator + 1);
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const imageResponses = [];
  const failedImages = [];
  const assertionFailures = [];

  function check(name, condition, detail = "") {
    if (!condition) {
      assertionFailures.push(name);
      console.log(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
      return;
    }

    console.log(`PASS ${name}${detail ? `: ${detail}` : ""}`);
  }

  try {
    await context.addCookies([
      {
        name: cookieName,
        value: cookieValue,
        url: baseUrl,
        httpOnly: true,
        sameSite: "Lax",
        secure: baseUrl.startsWith("https://"),
      },
    ]);

    const page = await context.newPage();

    page.on("response", (response) => {
      const url = response.url();

      if (!url.includes("/_next/image") && !url.includes("/media/")) {
        return;
      }

      const entry = {
        status: response.status(),
        url,
        body: "",
      };

      imageResponses.push(entry);

      if (entry.status >= 400) {
        void response
          .text()
          .then((body) => {
            entry.body = body.slice(0, 800);
          })
          .catch(() => undefined);
      }
    });

    page.on("requestfailed", (request) => {
      const url = request.url();

      if (!url.includes("/_next/image") && !url.includes("/media/")) {
        return;
      }

      failedImages.push({
        status: 0,
        url,
        body: request.failure()?.errorText ?? "request failed",
      });
    });

    const adminResponse = await page.goto(`${baseUrl}/admin/products`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    check(
      "Admin products page loads",
      adminResponse?.status() === 200,
      `HTTP ${adminResponse?.status()}`,
    );
    await page.waitForFunction(
      (name) => document.body.innerText.includes(name),
      productName,
      { timeout: 30_000 },
    );
    await settle(page);
    const adminImageSelector = `img[alt=${JSON.stringify(productName)}]`;
    const adminImage = await imageInfo(page, adminImageSelector);
    check(
      "Admin product thumbnail loaded",
      adminImage.exists && adminImage.naturalWidth > 0,
      `exists=${adminImage.exists}, naturalWidth=${adminImage.naturalWidth}`,
    );

    const productResponse = await page.goto(`${baseUrl}/p/${productSlug}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    check(
      "Storefront product page loads",
      productResponse?.status() === 200,
      `HTTP ${productResponse?.status()}`,
    );
    await page.waitForSelector(".zf-gallery__main", { timeout: 30_000 });
    await settle(page);
    await assertRealImage(
      check,
      page,
      "Storefront product image loaded",
      ".zf-gallery__main",
      ".zf-gallery__main img",
    );

    const categoryResponse = await page.goto(
      `${baseUrl}/c/${categorySlug}`,
      { waitUntil: "domcontentloaded", timeout: 60_000 },
    );
    check(
      "Category page loads",
      categoryResponse?.status() === 200,
      `HTTP ${categoryResponse?.status()}`,
    );
    await page.waitForSelector(
      `a.zf-product[href="/p/${productSlug}"]`,
      { timeout: 30_000 },
    );
    await settle(page);
    await assertRealImage(
      check,
      page,
      "Category product image loaded",
      `a.zf-product[href="/p/${productSlug}"]`,
      `a.zf-product[href="/p/${productSlug}"] img`,
    );

    const homeResponse = await page.goto(`${baseUrl}/`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    check(
      "Storefront home page loads",
      homeResponse?.status() === 200,
      `HTTP ${homeResponse?.status()}`,
    );
    await page.waitForSelector(".zf-hero", { timeout: 30_000 });
    await settle(page);
    await assertRealImage(
      check,
      page,
      "Home hero image loaded",
      ".zf-hero__slide.is-active",
      ".zf-hero__slide.is-active img",
    );

    await settle(page, 1_000);

    const badImageResponses = imageResponses.filter(
      (entry) => entry.status >= 400 || entry.status === 0,
    );
    const allFailures = [...badImageResponses, ...failedImages];

    if (allFailures.length > 0) {
      for (const entry of allFailures) {
        console.log(
          `FAIL image request: status=${entry.status} url=${entry.url} body=${entry.body || "none"}`,
        );
      }
    }

    check(
      "No failed image requests",
      allFailures.length === 0,
      `${imageResponses.length} image responses, ${allFailures.length} failed`,
    );

    const statusSummary = [
      ...new Set(imageResponses.map((entry) => entry.status)),
    ].join(", ");
    console.log(
      `Image response summary: ${imageResponses.length} responses, statuses=${statusSummary || "none"}`,
    );

    if (assertionFailures.length > 0 || allFailures.length > 0) {
      throw new Error(
        `Image browser checks failed: ${assertionFailures.join(", ") || "image requests"}`,
      );
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const baseUrl = process.env.STACK_BASE_URL;
  const adminCookie = process.env.STACK_ADMIN_COOKIE;
  const productSlug = process.env.STACK_PRODUCT_SLUG;
  const categorySlug = process.env.STACK_CATEGORY_SLUG;
  const productName = process.env.STACK_PRODUCT_NAME;

  if (
    !baseUrl ||
    !adminCookie ||
    !productSlug ||
    !categorySlug ||
    !productName
  ) {
    console.error(
      "STACK_BASE_URL, STACK_ADMIN_COOKIE, STACK_PRODUCT_SLUG, STACK_CATEGORY_SLUG, and STACK_PRODUCT_NAME are required.",
    );
    process.exitCode = 1;
  } else {
    try {
      await runStackImageChecks({
        baseUrl,
        adminCookie,
        productSlug,
        categorySlug,
        productName,
      });
      console.log("PASS: stack image browser checks.");
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
