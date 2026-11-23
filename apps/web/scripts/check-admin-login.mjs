import assert from "node:assert/strict";
import process from "node:process";
import { chromium } from "@playwright/test";

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

function trackSupabaseRequests(context, sink) {
  context.on("request", (request) => {
    if (!request.url().toLowerCase().includes("supabase")) {
      return;
    }

    if (request.method() === "GET" && request.resourceType() === "image") {
      sink.storageImages.push(request.url());
      return;
    }

    sink.violations.push(
      `${request.method()} ${request.resourceType()} ${request.url()}`,
    );
  });
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

async function assertLoginRedirect(page, path) {
  await page.goto(`${BASE_URL}${path}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForURL(/\/admin\/login(?:\?.*)?$/, { timeout: 20000 });

  const url = new URL(page.url());
  assert.equal(url.pathname, "/admin/login");
}

async function main() {
  const browser = await chromium.launch();
  const sink = { violations: [], storageImages: [] };
  let failures = 0;

  try {
    const context = await browser.newContext();
    trackSupabaseRequests(context, sink);
    await addAdminCookie(context);

    const meResponse = await context.request.get(
      `${BASE_URL}/api/admin-auth/me`,
    );
    assert.equal(meResponse.status(), 200);
    const admin = await meResponse.json();
    assert.equal(typeof admin.email, "string");
    assert.equal(typeof admin.role, "string");

    const page = await context.newPage();

    await page.goto(`${BASE_URL}/admin`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page
      .getByRole("button", { name: "Logout" })
      .waitFor({ timeout: 20000 });
    await page.getByText(admin.email, { exact: false }).first().waitFor();
    assert.equal(new URL(page.url()).pathname, "/admin");
    console.log(`/admin renders admin shell for ${admin.email} (${admin.role}).`);

    await page.goto(`${BASE_URL}/admin/products`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page
      .getByRole("button", { name: "Logout" })
      .waitFor({ timeout: 20000 });
    await page.getByText(admin.email, { exact: false }).first().waitFor();
    assert.equal(new URL(page.url()).pathname, "/admin/products");
    console.log("/admin/products renders the admin shell with the same email.");

    await page.goto(`${BASE_URL}/admin/settings`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    const storeNameInput = page.getByLabel("Store name");
    await storeNameInput.waitFor({ timeout: 20000 });
    assert.equal(await storeNameInput.isEnabled(), true);
    assert.equal(
      await page
        .getByText("Only the owner can make changes.", { exact: true })
        .count(),
      0,
    );
    console.log(
      "Owner-only settings controls are enabled from the role returned by /admin/me.",
    );

    const documentCookie = await page.evaluate(() => document.cookie);
    assert.equal(documentCookie.includes("zf_admin_session"), false);
    const cookies = await context.cookies(BASE_URL);
    const adminCookie = cookies.find(
      (cookie) => cookie.name === "zf_admin_session",
    );
    assert.ok(adminCookie);
    assert.equal(adminCookie.httpOnly, true);
    console.log("zf_admin_session is HttpOnly (not visible to document.cookie).");

    await page.getByRole("button", { name: "Logout" }).click();
    await page.waitForURL(/\/admin\/login(?:\?.*)?$/, { timeout: 20000 });

    const afterLogoutCookies = await context.cookies(BASE_URL);
    assert.equal(
      afterLogoutCookies.some(
        (cookie) => cookie.name === "zf_admin_session",
      ),
      false,
    );
    console.log("Logout clears the zf_admin_session cookie.");

    await page.goto(`${BASE_URL}/admin/products`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForURL(/\/admin\/login(?:\?.*)?$/, { timeout: 20000 });
    assert.equal(new URL(page.url()).pathname, "/admin/login");
    console.log("/admin/products redirects to /admin/login after logout.");

    const anonymousContext = await browser.newContext();
    trackSupabaseRequests(anonymousContext, sink);
    const anonymousPage = await anonymousContext.newPage();
    await assertLoginRedirect(anonymousPage, "/admin/products");
    console.log("/admin/products redirects to /admin/login without a cookie.");

    const invalidContext = await browser.newContext();
    trackSupabaseRequests(invalidContext, sink);
    await invalidContext.addCookies([
      {
        name: "zf_admin_session",
        value: "invalid-admin-session-token",
        url: BASE_URL,
        httpOnly: true,
        sameSite: "Lax",
        secure: BASE_URL.startsWith("https://"),
      },
    ]);
    const invalidPage = await invalidContext.newPage();
    await assertLoginRedirect(invalidPage, "/admin/products");
    console.log(
      "/admin/products redirects to /admin/login with an invalid cookie.",
    );

    assert.deepEqual(sink.violations, []);
    console.log(
      "Zero browser requests to hosts containing 'supabase' while browsing admin pages.",
    );

    if (sink.storageImages.length > 0) {
      console.log(
        `Storage image GETs (allowed until Phase 5): ${sink.storageImages.length}`,
      );
      for (const url of [...new Set(sink.storageImages)].slice(0, 10)) {
        console.log(`  ${url}`);
      }
    } else {
      console.log("Storage image GETs (allowed until Phase 5): 0");
    }
  } catch (error) {
    failures += 1;
    console.error("FAIL: admin cookie-session check.");
    console.error(error instanceof Error ? error.message : error);
  } finally {
    await browser.close();
  }

  if (failures > 0) {
    process.exitCode = 1;
    return;
  }

  console.log("PASS: admin cookie-session Playwright checks.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
