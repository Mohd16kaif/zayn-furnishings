import assert from "node:assert/strict";
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
const TOKEN = process.env.ADMIN_SESSION_TOKEN;

if (!TOKEN) {
  console.error(
    "ADMIN_SESSION_TOKEN is required. Mint one with pnpm --filter @zayn/api admin:mint-dev-session.",
  );
  process.exit(1);
}

function pass(name) {
  console.log(`PASS ${name}`);
}

async function addAdminCookie(context) {
  await context.addCookies([
    {
      name: "zf_admin_session",
      value: TOKEN,
      url: BASE_URL,
      httpOnly: true,
      sameSite: "Lax",
      secure: BASE_URL.startsWith("https://"),
    },
  ]);
}

async function adminRequest(context, method, requestPath, data) {
  const response = await context.request.fetch(
    `${BASE_URL}${requestPath}`,
    {
      method,
      data,
    },
  );

  if (!response.ok()) {
    const text = await response.text().catch(() => "");

    throw new Error(
      `${method} ${requestPath} returned ${response.status()}${
        text ? `: ${text.slice(0, 200)}` : ""
      }`,
    );
  }

  return response.json().catch(() => null);
}

async function readProduct(context, productId) {
  return adminRequest(
    context,
    "GET",
    `/api/admin-proxy/admin/products/${productId}`,
  );
}

async function waitForProductPagePrice(page, slug, expected, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await page.goto(`${BASE_URL}/p/${slug}`, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      const count = await page
        .getByText(expected, { exact: true })
        .count();

      if (count > 0) {
        return true;
      }
    } catch {
      // The page may still be revalidating. Try again until the deadline.
    }

    await page.waitForTimeout(1_000);
  }

  return false;
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  let category = null;
  let productA = null;
  let productB = null;

  try {
    await addAdminCookie(context);

    const suffix = `${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const categoryName = `Price check category ${suffix}`;
    const productAName = `Price check chair ${suffix}`;
    const productBName = `Price check table ${suffix}`;

    category = await adminRequest(
      context,
      "POST",
      "/api/admin-proxy/admin/categories",
      { name: categoryName, is_active: true },
    );
    productA = await adminRequest(
      context,
      "POST",
      "/api/admin-proxy/admin/products",
      {
        name: productAName,
        price_cents: 1000,
        sku: `PC-${suffix}-A`,
        status: "active",
        category_id: category.id,
      },
    );
    productB = await adminRequest(
      context,
      "POST",
      "/api/admin-proxy/admin/products",
      {
        name: productBName,
        price_cents: 2000,
        sku: `PC-${suffix}-B`,
        status: "active",
        category_id: category.id,
      },
    );

    pass("Created two throwaway products in a throwaway category.");

    const adminPage = await context.newPage();
    await adminPage.goto(`${BASE_URL}/admin/products`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });

    const changeButton = adminPage.getByRole("button", {
      name: "Change prices",
    });
    await changeButton.waitFor({ timeout: 20_000 });
    pass("Owner sees the Change prices button on the Products page.");

    await changeButton.click();
    await adminPage
      .getByRole("heading", { name: "Change prices" })
      .waitFor({ timeout: 10_000 });
    let panel = adminPage.getByRole("dialog");

    const fits = await adminPage.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    );
    assert.equal(fits, true, "The price change panel must fit at 390px.");
    pass("Price change panel fits at 390px without horizontal overflow.");

    const historySection = panel
      .locator("section")
      .filter({ hasText: "Recent price changes" });
    await panel
      .getByText("Loading recent price changes...")
      .waitFor({ state: "detached", timeout: 20_000 })
      .catch(() => undefined);
    const historyCountBefore = await historySection
      .getByRole("listitem")
      .count();

    await adminPage.getByLabel("Where").selectOption("all");
    await adminPage.getByRole("button", { name: "Continue" }).click();
    await adminPage.getByLabel("Direction").selectOption("decrease");
    await adminPage.getByLabel("Type").selectOption("percent");
    await adminPage.getByLabel("Percent").fill("99");
    await adminPage
      .getByRole("button", { name: "Preview changes" })
      .click();
    await panel
      .getByRole("alert")
      .filter({ hasText: "Enter a percentage from 0.01 to 90." })
      .waitFor({ timeout: 10_000 });
    pass("Percent validation refuses 99 with the 0.01 to 90 message.");

    await adminPage.getByLabel("Type").selectOption("amount");
    await adminPage.getByLabel("Amount (USD)").fill("1000000");
    await adminPage.getByLabel("Apply to").selectOption("regular");
    await adminPage.getByLabel("Rounding").selectOption("none");
    await adminPage
      .getByRole("button", { name: "Preview changes" })
      .click();

    await panel
      .getByText(/0 products will change/)
      .waitFor({ timeout: 20_000 });
    await panel
      .getByText(
        "Some products will be skipped. Review the reasons in the table before applying.",
      )
      .waitFor();
    assert.ok(
      (await panel
        .getByText(/The new regular price would be below \$1\.00\./)
        .count()) >= 2,
      "Expected blocked rows with the below-minimum reason.",
    );
    assert.ok(
      (await panel.getByText("Skipped", { exact: true }).count()) >= 2,
      "Expected at least two Skipped badges.",
    );
    assert.equal(
      await panel
        .getByRole("button", { name: "Apply prices" })
        .isDisabled(),
      true,
      "Apply prices must be disabled when nothing can change.",
    );
    assert.equal(
      await historySection.getByRole("listitem").count(),
      historyCountBefore,
      "A blocked preview must not add a Recent price changes entry.",
    );

    const productAAfterBlocked = await readProduct(context, productA.id);
    const productBAfterBlocked = await readProduct(context, productB.id);

    assert.equal(productAAfterBlocked.price_cents, 1000);
    assert.equal(productBAfterBlocked.price_cents, 2000);
    pass(
      "Blocked preview shows skipped rows and reasons; apply is disabled and no history entry or price change was made.",
    );

    await panel.getByRole("button", { name: "Close" }).click();
    await panel.waitFor({ state: "detached" });
    await changeButton.click();
    await adminPage
      .getByRole("heading", { name: "Change prices" })
      .waitFor({ timeout: 10_000 });
    panel = adminPage.getByRole("dialog");

    await adminPage.getByLabel("Where").selectOption(category.id);
    await adminPage
      .getByLabel("Product status")
      .selectOption("active");
    await adminPage.getByRole("button", { name: "Continue" }).click();

    await adminPage.getByLabel("Direction").selectOption("increase");
    await adminPage.getByLabel("Type").selectOption("percent");
    await adminPage.getByLabel("Percent").fill("10");
    await adminPage
      .getByLabel("Apply to")
      .selectOption("regular");
    await adminPage.getByLabel("Rounding").selectOption("end_99");
    await adminPage
      .getByRole("button", { name: "Preview changes" })
      .click();

    await panel
      .getByText("2 products will change")
      .waitFor({ timeout: 20_000 });
    await panel.getByText(productAName).waitFor();
    await panel.getByText(productBName).waitFor();
    await panel.getByText("$11.99", { exact: true }).waitFor();
    await panel.getByText("$22.99", { exact: true }).waitFor();
    await panel.getByText("$10.00", { exact: true }).waitFor();
    await panel.getByText("$20.00", { exact: true }).waitFor();
    await panel.getByText("+$1.99", { exact: true }).waitFor();
    await panel.getByText("+$2.99", { exact: true }).waitFor();

    const willChangeBadges = await panel
      .getByText("Will change", { exact: true })
      .count();
    assert.ok(willChangeBadges >= 2, "Expected two Will change rows.");

    pass(
      "Preview shows 2 products, old $10.00/$20.00, new $11.99/$22.99 and the differences.",
    );

    await adminPage
      .getByRole("button", { name: "Apply prices" })
      .click();

    const applyDialog = adminPage.getByRole("alertdialog");
    await applyDialog.waitFor({ timeout: 10_000 });
    await applyDialog.getByText("2 products will change").waitFor();
    await applyDialog.getByText(/undo this later/i).waitFor();
    await applyDialog
      .getByRole("button", { name: "Apply new prices" })
      .click();

    await panel
      .getByRole("heading", { name: "Prices changed" })
      .waitFor({ timeout: 20_000 });
    await panel.getByText("2 products changed").waitFor();
    pass("Apply succeeds for exactly 2 products and the panel confirms it.");

    const storefrontPage = await context.newPage();
    assert.equal(
      await waitForProductPagePrice(storefrontPage, productA.slug, "$11.99"),
      true,
      "The first storefront product page did not show $11.99 within 15 seconds.",
    );
    assert.equal(
      await waitForProductPagePrice(storefrontPage, productB.slug, "$22.99"),
      true,
      "The second storefront product page did not show $22.99 within 15 seconds.",
    );
    pass("Storefront product pages show the new prices within 15 seconds.");

    const historyItem = panel
      .getByRole("listitem")
      .filter({ hasText: categoryName })
      .first();
    await historyItem.waitFor({ timeout: 20_000 });
    await historyItem.getByRole("button", { name: "Undo" }).click();

    const undoDialog = adminPage.getByRole("alertdialog");
    await undoDialog.waitFor({ timeout: 10_000 });
    await undoDialog.getByText(/Products that changed since then/i).waitFor();
    await undoDialog
      .getByRole("button", { name: "Undo price change" })
      .click();

    await panel
      .getByText(/Restored 2 prices/)
      .first()
      .waitFor({ timeout: 20_000 });
    await historyItem.getByText(/Undone/).waitFor({ timeout: 20_000 });
    pass("Undo restores the batch and marks it undone in Recent price changes.");

    assert.equal(
      await waitForProductPagePrice(storefrontPage, productA.slug, "$10.00"),
      true,
      "The first storefront product page did not return to $10.00 within 15 seconds.",
    );
    assert.equal(
      await waitForProductPagePrice(storefrontPage, productB.slug, "$20.00"),
      true,
      "The second storefront product page did not return to $20.00 within 15 seconds.",
    );
    pass("Storefront product pages return to the old prices within 15 seconds.");

    await adminRequest(
      context,
      "DELETE",
      `/api/admin-proxy/admin/products/${productA.id}`,
    );
    await adminRequest(
      context,
      "DELETE",
      `/api/admin-proxy/admin/products/${productB.id}`,
    );
    await adminRequest(
      context,
      "DELETE",
      `/api/admin-proxy/admin/categories/${category.id}`,
    );
    productA = null;
    productB = null;
    category = null;
    pass("Throwaway products and category were removed.");
  } finally {
    if (category?.id) {
      if (productA?.id) {
        await adminRequest(
          context,
          "DELETE",
          `/api/admin-proxy/admin/products/${productA.id}`,
        ).catch(() => undefined);
      }

      if (productB?.id) {
        await adminRequest(
          context,
          "DELETE",
          `/api/admin-proxy/admin/products/${productB.id}`,
        ).catch(() => undefined);
      }

      await adminRequest(
        context,
        "DELETE",
        `/api/admin-proxy/admin/categories/${category.id}`,
      ).catch(() => undefined);
    }

    await browser.close();
  }

  console.log("PASS: price change Playwright checks.");
}

main().catch((error) => {
  console.error(
    `FAIL: price change Playwright checks. ${
      error instanceof Error ? error.message : error
    }`,
  );
  process.exitCode = 1;
});
