import { spawnSync } from "node:child_process";
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
const REPO_ROOT = path.resolve(process.cwd(), "../..");
const SCREENSHOT_DIR = path.resolve(process.cwd(), "docs/screenshots");
const TEST_PHONE = "2025550147";
const TEST_EMAIL = "checkout-e2e@example.com";
const TEST_NAME = "Checkout E2E";

function helper(...args) {
  const escaped = args.map(
    (arg) => `"${String(arg).replace(/"/g, '\\"')}"`,
  );
  const command = `pnpm --filter @zayn/api exec tsx src/scripts/e2eCheckoutHelper.ts ${escaped.join(" ")}`;
  const result = spawnSync(command, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: true,
  });

  if (result.status !== 0) {
    throw new Error(
      `Helper failed (${args[0]}): ${result.stderr || result.stdout}`,
    );
  }

  const line = result.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .pop();

  return JSON.parse(line);
}

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

async function firstProductWithStock() {
  const result = await fetchJson(
    `${API_URL}/api/public/products?page_size=12&in_stock=true`,
  );

  if (!result.ok) {
    return null;
  }

  for (const item of result.data?.items ?? []) {
    try {
      const stock = helper("stock", item.id);

      if (stock.stock >= 2) {
        const quantity = stock.stock >= 3 ? 2 : 1;

        return { product: item, quantity, stockBefore: stock.stock };
      }
    } catch {
      // Try the next product.
    }
  }

  return null;
}

async function deliveryZip(subtotalCents) {
  const candidates = ["10001", "90210", "60601", "30301", "75201", "98101"];

  for (const zip of candidates) {
    const result = await fetchJson(
      `${API_URL}/api/public/delivery/check?zip=${zip}&subtotal_cents=${subtotalCents}`,
    );

    if (result.ok && result.data?.available) {
      return zip;
    }
  }

  return null;
}

async function assertServers() {
  const [web, api] = await Promise.all([
    fetch(BASE_URL).catch(() => null),
    fetch(`${API_URL}/health`).catch(() => null),
  ]);

  return Boolean(
    web && (web.ok || web.status < 500) && api && api.status < 500,
  );
}

async function addToCart(page, product, quantity) {
  await page.goto(`${BASE_URL}/p/${product.slug}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.locator("#pdp-quantity").selectOption(String(quantity));
  await page
    .getByRole("button", { name: /^Add .* to cart$/ })
    .click();
  await page.waitForSelector(".zf-toast", { timeout: 10000 });
}

async function fillCheckout(page, zip, email = TEST_EMAIL) {
  await page.locator("#checkout-email").fill(email);
  await page.locator("#checkout-name").fill(TEST_NAME);
  await page.locator("#checkout-line1").fill("123 Test Avenue");
  await page.locator("#checkout-city").fill("New York");
  await page.locator("#checkout-state").selectOption("NY");
  await page.locator("#checkout-zip").fill(zip);
  await page.locator("#checkout-zip").blur();
  await page
    .getByText(new RegExp(`Delivery to ${zip}`))
    .first()
    .waitFor({ timeout: 20000 });
}

async function signIn(page) {
  await page.locator("#signin-phone").fill(TEST_PHONE);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.locator("#signin-code").waitFor({ timeout: 20000 });
  const devModeNote = await page
    .getByText("Dev mode: use code 123456")
    .isVisible()
    .catch(() => false);
  await page.locator("#signin-code").fill("123456");
  await page
    .getByRole("button", { name: "Verify and sign in" })
    .click();
  await page.locator("#checkout-email").waitFor({ timeout: 20000 });

  return devModeNote;
}

async function startOrder(page, zip, item, quantity) {
  await fillCheckout(page, zip);

  const responsePromise = page
    .waitForResponse(
      (candidate) =>
        candidate.url().includes("/api/orders") &&
        candidate.request().method() === "POST",
      { timeout: 15000 },
    )
    .catch(() => null);

  await page
    .getByRole("button", { name: "Continue to payment" })
    .click();

  const response = await responsePromise;

  if (response) {
    const data = await response.json().catch(() => null);

    if (!response.ok() || !data?.client_secret) {
      throw new Error(
        `Order creation failed (${response.status()}): ${
          data?.error ?? "no client secret"
        }`,
      );
    }

    return { source: "ui", order: data };
  }

  const errorText = await page
    .locator(".zf-checkout__order-error")
    .innerText()
    .catch(() => "");

  if (!/not configured/i.test(errorText)) {
    throw new Error(
      `Order creation did not start: ${errorText.trim() || "unknown error"}`,
    );
  }

  const apiResponse = await page.context().request.post(`${BASE_URL}/api/orders`, {
    data: {
      items: [
        {
          product_id: item.id,
          quantity,
        },
      ],
      zip,
      email: TEST_EMAIL,
      shipping_address: {
        name: TEST_NAME,
        line1: "123 Test Avenue",
        city: "New York",
        state: "NY",
        zip,
      },
      sms_opt_in: false,
    },
  });
  const data = await apiResponse.json().catch(() => null);

  if (!apiResponse.ok() || !data?.client_secret) {
    throw new Error(
      `API order creation failed (${apiResponse.status()}): ${
        data?.error ?? "no client secret"
      }`,
    );
  }

  return {
    source: "api-fallback",
    order: data,
    message: errorText.trim(),
  };
}

async function stripeCardFrame(page) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    for (const frame of page.frames()) {
      if (!frame.url().includes("js.stripe.com")) {
        continue;
      }

      try {
        if (await frame.locator('input[name="number"]').count()) {
          return frame;
        }
      } catch {
        // Frame may be navigating.
      }
    }

    await page.waitForTimeout(500);
  }

  return null;
}

async function fillCard(frame, number) {
  await frame
    .locator('input[name="number"]')
    .fill(number, { timeout: 15000 });
  await frame
    .locator('input[name="expiry"]')
    .fill("12 / 34", { timeout: 15000 });
  await frame
    .locator('input[name="cvc"]')
    .fill("123", { timeout: 15000 });

  const postal = frame.locator('input[name="postalCode"]');

  if (await postal.count()) {
    await postal.fill("10001", { timeout: 15000 });
  }
}

async function readOrderStatus(page, orderNumber) {
  return page.evaluate(async (number) => {
    const response = await fetch(`/api/orders/${number}`);
    const data = await response.json().catch(() => null);

    return {
      ok: response.ok,
      status: data?.status ?? null,
    };
  }, orderNumber);
}

async function main() {
  if (!(await assertServers())) {
    console.error(
      `Servers not reachable (web ${BASE_URL}, api ${API_URL}). Start "pnpm dev" first.`,
    );
    process.exit(2);
  }

  const selection = await firstProductWithStock();

  if (!selection) {
    console.error("No in-stock product with readable stock was found.");
    process.exit(2);
  }

  const { product, quantity, stockBefore } = selection;
  const zip = await deliveryZip(
    (product.sale_price_cents ?? product.price_cents) * quantity,
  );

  if (!zip) {
    console.error("No delivery ZIP is currently covered by any zone.");
    process.exit(2);
  }

  await mkdir(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const orderNumbers = [];
  const summary = {
    product: product.name,
    product_id: product.id,
    quantity,
    zip,
    stock_before: stockBefore,
    paid_order: null,
    paid_status: null,
    stock_after_paid: null,
    declined_order: null,
    declined_status: null,
    declined_error: null,
    payment_element_automated: false,
    payment_mode: null,
    payments_ui_message: null,
    dev_mode_note: null,
    account_listed: false,
    stock_after_cleanup: null,
    screenshots: [],
  };

  try {
    await addToCart(page, product, quantity);
    await page.goto(`${BASE_URL}/checkout`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.locator("#signin-phone").waitFor({ timeout: 20000 });
    summary.dev_mode_note = await signIn(page);

    const paidStart = await startOrder(page, zip, product, quantity);
    const paidOrder = paidStart.order;
    summary.payment_mode = paidStart.source;
    orderNumbers.push(paidOrder.order_number);
    summary.paid_order = paidOrder.order_number;

    if (paidStart.source === "api-fallback") {
      summary.payments_ui_message = paidStart.message;
      await page.screenshot({
        path: path.join(
          SCREENSHOT_DIR,
          "e2e-payments-not-configured.png",
        ),
      });
      summary.screenshots.push(
        path.join(SCREENSHOT_DIR, "e2e-payments-not-configured.png"),
      );
    }

    let paidViaBrowser = false;

    if (paidStart.source === "ui") {
      try {
        await page.waitForSelector('iframe[name^="__privateStripeFrame"]', {
          timeout: 30000,
        });
        const frame = await stripeCardFrame(page);

        if (!frame) {
          throw new Error("Stripe card inputs were not found.");
        }

        await fillCard(frame, "4242424242424242");
        summary.payment_element_automated = true;

        await page
          .getByRole("button", { name: /^Pay \$/ })
          .click({ timeout: 15000 });
        await page.waitForURL(/\/order\/ZF-/, { timeout: 45000 });
        paidViaBrowser = true;
      } catch (error) {
        console.log(
          `Payment Element automation failed: ${
            error instanceof Error ? error.message : error
          }. Falling back to API confirmation.`,
        );
        await page.screenshot({
          path: path.join(
            SCREENSHOT_DIR,
            "e2e-payment-element-failure.png",
          ),
        });
        summary.screenshots.push(
          path.join(
            SCREENSHOT_DIR,
            "e2e-payment-element-failure.png",
          ),
        );
      }
    } else {
      console.log(
        "Payment Element is not configured; using API confirmation with pm_card_visa.",
      );
    }

    const paymentIntentId = paidOrder.client_secret.split("_secret_")[0];

    if (!paidViaBrowser) {
      helper("confirm", paidOrder.client_secret);
      await page.goto(`${BASE_URL}/order/${paidOrder.order_number}`, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
    }

    helper("webhook", paymentIntentId);

    await page.locator(".zf-order__status--paid").waitFor({
      timeout: 45000,
    });
    summary.paid_status = "paid";
    summary.stock_after_paid = helper("stock", product.id).stock;

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "e2e-order-paid.png"),
    });
    summary.screenshots.push(
      path.join(SCREENSHOT_DIR, "e2e-order-paid.png"),
    );

    await page.goto(`${BASE_URL}/account`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page
      .getByText(paidOrder.order_number, { exact: true })
      .first()
      .waitFor({ timeout: 20000 });
    summary.account_listed = true;
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "e2e-account-paid.png"),
    });
    summary.screenshots.push(
      path.join(SCREENSHOT_DIR, "e2e-account-paid.png"),
    );

    await addToCart(page, product, 1);
    await page.goto(`${BASE_URL}/checkout`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.locator("#checkout-email").waitFor({ timeout: 20000 });

    const declinedStart = await startOrder(page, zip, product, 1);
    const declinedOrder = declinedStart.order;
    orderNumbers.push(declinedOrder.order_number);
    summary.declined_order = declinedOrder.order_number;

    if (declinedStart.source === "ui") {
      try {
        const frame = await stripeCardFrame(page);

        if (!frame) {
          throw new Error("Stripe card inputs were not found.");
        }

        await fillCard(frame, "4000000000009995");
        await page
          .getByRole("button", { name: /^Pay \$/ })
          .click({ timeout: 15000 });
        await page.waitForFunction(
          () => {
            const error = document.querySelector(
              ".zf-payment .zf-form__error",
            );

            return Boolean(error?.textContent?.trim());
          },
          { timeout: 45000 },
        );
        const errorText = await page
          .locator(".zf-payment .zf-form__error")
          .innerText();
        summary.declined_error = errorText.trim();
        summary.payment_element_automated = true;
      } catch (error) {
        console.log(
          `Declined-card automation failed: ${
            error instanceof Error ? error.message : error
          }. Falling back to API decline.`,
        );
        const decline = helper("decline", declinedOrder.client_secret);
        summary.declined_error =
          decline.message ??
          `Declined through API fallback (status ${decline.status ?? "unknown"}).`;
      }
    } else {
      const decline = helper("decline", declinedOrder.client_secret);
      summary.declined_error =
        decline.message ??
        `Declined through API fallback (status ${decline.status ?? "unknown"}).`;
    }

    const declinedStatus = await readOrderStatus(
      page,
      declinedOrder.order_number,
    );
    summary.declined_status = declinedStatus.status;

    await page.goto(
      `${BASE_URL}/order/${declinedOrder.order_number}`,
      {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      },
    );
    await page.locator(".zf-order__status").waitFor({ timeout: 20000 });

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "e2e-order-declined.png"),
    });
    summary.screenshots.push(
      path.join(SCREENSHOT_DIR, "e2e-order-declined.png"),
    );

    if (
      summary.paid_status !== "paid" ||
      summary.declined_status !== "pending" ||
      summary.stock_after_paid === null ||
      summary.dev_mode_note !== true ||
      !summary.account_listed
    ) {
      throw new Error("One or more end-to-end assertions failed.");
    }
  } finally {
    try {
      if (orderNumbers.length > 0) {
        helper("cleanup", TEST_PHONE, orderNumbers.join(","));
      }
    } catch (error) {
      console.error(
        `Cleanup failed: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }

    try {
      summary.stock_after_cleanup = helper("stock", product.id).stock;
    } catch {
      summary.stock_after_cleanup = null;
    }

    await browser.close();
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
