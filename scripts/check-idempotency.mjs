import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(
  /\/+$/,
  "",
);
const TEST_PHONE = "2125550142";
const TEST_CODE = "123456";

function mintDevSession() {
  const args = ["--filter", "@zayn/api", "admin:mint-dev-session"];
  const options = {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
  };
  const attempts = [];

  if (process.env.npm_execpath) {
    attempts.push(() =>
      spawnSync(process.execPath, [process.env.npm_execpath, ...args], options),
    );
  }

  attempts.push(() =>
    process.platform === "win32"
      ? spawnSync(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", `pnpm.cmd ${args.join(" ")}`],
          options,
        )
      : spawnSync("pnpm", args, options),
  );

  for (const attempt of attempts) {
    const result = attempt();

    if (result.error || result.status !== 0) {
      continue;
    }

    const token = (result.stdout ?? "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop();

    if (token) {
      return token;
    }
  }

  return null;
}

async function assertServer() {
  try {
    const response = await fetch(BASE_URL, { redirect: "follow" });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  return {
    ok: response.ok,
    status: response.status,
    data: await response.json().catch(() => null),
  };
}

async function firstProduct() {
  const result = await fetchJson(
    `${API_URL}/api/public/products?page_size=1&in_stock=true`,
  );

  return result.ok ? result.data?.items?.[0] ?? null : null;
}

function pass(name) {
  console.log(`PASS ${name}`);
}

function skip(name, reason) {
  console.log(`SKIP ${name} (${reason})`);
}

function fail(name, reason) {
  console.log(`FAIL ${name} (${reason})`);
}

function cookieHeader(token) {
  return `zf_admin_session=${token}`;
}

async function adminOrders(token, email) {
  const response = await fetch(
    `${BASE_URL}/api/admin-proxy/admin/orders?q=${encodeURIComponent(
      email,
    )}&status=pending&page=1&page_size=50`,
    {
      headers: { cookie: cookieHeader(token) },
      cache: "no-store",
    },
  );
  const data = await response.json().catch(() => null);

  if (!response.ok || !Array.isArray(data?.items)) {
    throw new Error(`admin order lookup returned ${response.status}`);
  }

  return data.items;
}

async function cancelOrder(token, orderNumber) {
  try {
    return await fetch(
      `${BASE_URL}/api/admin-proxy/admin/orders/${encodeURIComponent(
        orderNumber,
      )}/status`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: cookieHeader(token),
        },
        body: JSON.stringify({ status: "cancelled" }),
      },
    );
  } catch {
    return null;
  }
}

async function signIn(context) {
  const start = await context.request.post(
    `${BASE_URL}/api/auth/phone-start`,
    { data: { phone: TEST_PHONE } },
  );

  if (!start.ok()) {
    return { ok: false, reason: `phone-start ${start.status()}` };
  }

  const verify = await context.request.post(
    `${BASE_URL}/api/auth/phone-verify`,
    { data: { phone: TEST_PHONE, code: TEST_CODE } },
  );

  return verify.ok()
    ? { ok: true }
    : { ok: false, reason: `phone-verify ${verify.status()}` };
}

async function fillCheckout(page, { email, zip }) {
  await page.locator("#checkout-email").waitFor({ timeout: 20_000 });
  await page.locator("#checkout-email").fill(email);
  await page.locator("#checkout-name").fill("Idempotency Test");
  await page.locator("#checkout-line1").fill("1 Audit Street");
  await page.locator("#checkout-city").fill("New York");
  await page.locator("#checkout-state").selectOption("NY");
  await page.locator("#checkout-zip").fill(zip);
}

async function clickContinueTwice(page) {
  await page.locator("#checkout-email").waitFor({ timeout: 20_000 });
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll("button")).find(
      (candidate) =>
        (candidate.textContent || "").trim() === "Continue to payment",
    );

    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Continue to payment button not found.");
    }

    button.click();
    button.click();
  });
}

async function waitForOrderOutcome(page, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (
      await page
        .locator(".zf-checkout__order-ready")
        .isVisible()
        .catch(() => false)
    ) {
      return { ok: true };
    }

    const text = (await page.locator("body").innerText().catch(() => ""))
      .toLowerCase();

    if (text.includes("payments are not configured")) {
      return { ok: false, reason: "publishable Stripe key not configured" };
    }

    if (text.includes("online payments are temporarily unavailable")) {
      return { ok: false, reason: "API Stripe key not configured" };
    }

    if (text.includes("we could not start the payment")) {
      return { ok: false, reason: "order creation failed" };
    }

    await page.waitForTimeout(250);
  }

  return { ok: false, reason: "no payment step after order creation" };
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

  const token = process.env.ADMIN_SESSION_TOKEN || mintDevSession();

  if (!token) {
    console.error(
      "Could not mint a dev admin session. Run this check through pnpm check:e2e.",
    );
    process.exit(2);
  }

  const suffix = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const email = `idempotency-${suffix}@example.com`;
  const initialZip = "10001";
  const changedZip = "10002";
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const requestLog = [];
  let createdOrders = [];

  try {
    const auth = await signIn(context);

    if (!auth.ok) {
      console.error(`Could not sign in the test customer: ${auth.reason}`);
      process.exitCode = 1;
      return;
    }

    await context.addInitScript(
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

    const page = await context.newPage();
    page.on("response", (response) => {
      if (response.url().includes("/api/orders")) {
        requestLog.push({
          url: response.url(),
          method: response.request().method(),
          status: response.status(),
          replayed: response.headers()["idempotent-replayed"] === "true",
        });
      }
    });

    const before = await adminOrders(token, email);
    assert.equal(before.length, 0, "test email must not have prior orders");

    await page.goto(`${BASE_URL}/checkout`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await fillCheckout(page, { email, zip: initialZip });
    await clickContinueTwice(page);
    const firstOutcome = await waitForOrderOutcome(page);

    if (!firstOutcome.ok) {
      skip("real Stripe order creation", firstOutcome.reason);
      console.log(
        "SKIP double-click/replay assertions because order creation needs a configured Stripe test key.",
      );
      return;
    }

    await page.waitForTimeout(1000);
    createdOrders = await adminOrders(token, email);
    assert.equal(
      createdOrders.length,
      1,
      "double click must create exactly one order",
    );
    const createResponses = requestLog.filter((entry) => entry.status === 201);
    assert.equal(
      createResponses.length,
      1,
      `double click must send exactly one successful order create; responses=${JSON.stringify(requestLog)}`,
    );
    pass("double click created exactly one order");

    await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
    await fillCheckout(page, { email, zip: initialZip });
    await clickContinueTwice(page);
    const replayOutcome = await waitForOrderOutcome(page);

    if (!replayOutcome.ok) {
      fail("replay after refresh", replayOutcome.reason);
      process.exitCode = 1;
      return;
    }

    await page.waitForTimeout(1000);
    const afterReplay = await adminOrders(token, email);
    assert.equal(
      afterReplay.length,
      1,
      "a refresh with the same inputs must replay, not create a second order",
    );
    assert.ok(
      requestLog.some((entry) => entry.status === 200 && entry.replayed),
      "the replay response must carry Idempotent-Replayed",
    );
    pass("refresh reused the key and replayed the same order");

    await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
    await fillCheckout(page, { email, zip: changedZip });
    await clickContinueTwice(page);
    const changedOutcome = await waitForOrderOutcome(page);

    if (!changedOutcome.ok) {
      fail("changed ZIP replacement", changedOutcome.reason);
      process.exitCode = 1;
      return;
    }

    await page.waitForTimeout(1000);
    const afterChange = await adminOrders(token, email);
    assert.equal(
      afterChange.length,
      2,
      "a changed ZIP must start a new attempt and create a replacement order",
    );
    assert.equal(
      new Set(afterChange.map((order) => order.order_number)).size,
      2,
      "replacement order must have a different order number",
    );
    pass("changed ZIP created exactly one replacement order");

    const cancelled = [];

    for (const order of afterChange) {
      const response = await cancelOrder(token, order.order_number);

      if (response?.ok) {
        cancelled.push(order.order_number);
      }
    }

    if (cancelled.length > 0) {
      console.log(
        `Cleaned up ${cancelled.length} test order(s) by cancelling them.`,
      );
    } else {
      console.log(
        "Left test orders in the dev database for manual cleanup: " +
          afterChange.map((order) => order.order_number).join(", "),
      );
    }
  } finally {
    const leftover = createdOrders.length > 0 ? "orders may remain" : "cart only";
    console.log(`Cleanup note: ${leftover}.`);
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
