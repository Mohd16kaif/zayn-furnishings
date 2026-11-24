import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runStackImageChecks } from "./check-stack-images.mjs";
import {
  createComposeEnvValues,
  randomAlphanumeric,
  writeComposeEnvFile,
} from "./compose-init-env.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const COMPOSE_FILE = "docker-compose.stack.yml";
const PROJECT = "zayn-smoke";
const EDGE_PORT = "18080";
const EDGE = `http://localhost:${EDGE_PORT}`;
const API_IMAGE = "zayn-api:stack";
const WEB_IMAGE = "zayn-web:stack";

let envDir = null;
let envPath = null;

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
    timeout: options.timeout ?? 120_000,
    shell: false,
    env: {
      ...process.env,
      COMPOSE_ENV_FILE: envPath ?? process.env.COMPOSE_ENV_FILE,
    },
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `docker ${args.slice(0, 2).join(" ")} failed with exit code ${result.status}`,
    );
  }

  return result;
}

function compose(args, options = {}) {
  return docker(
    [
      "compose",
      "-p",
      PROJECT,
      "-f",
      COMPOSE_FILE,
      "--env-file",
      envPath,
      ...args,
    ],
    options,
  );
}

function captureCompose(args, options = {}) {
  const result = compose(args, options);

  return result.stdout.trim();
}

function check(name, condition, detail = "") {
  if (!condition) {
    throw new Error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  }

  console.log(`PASS ${name}${detail ? `: ${detail}` : ""}`);
}

async function waitFor(checkFn, label, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const value = await checkFn();

      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`,
  );
}

async function fetchTimeout(url, options = {}, timeoutMs = 15_000) {
  return fetch(url, {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function serviceContainer(service, all = false) {
  const id = captureCompose([
    "ps",
    ...(all ? ["-a"] : []),
    "-q",
    service,
  ]);

  if (!id) {
    throw new Error(`No container found for compose service ${service}.`);
  }

  return id.split(/\r?\n/)[0].trim();
}

function inspect(format, target) {
  return docker([
    "inspect",
    "--format",
    format,
    target,
  ]).stdout.trim();
}

async function waitForHealthy(containerId, label) {
  await waitFor(() => {
    const status = inspect("{{.State.Health.Status}}", containerId);
    return status === "healthy";
  }, label);
}

async function waitForEdge() {
  await waitFor(async () => {
    try {
      const response = await fetchTimeout(`${EDGE}/`);
      return response.status < 500;
    } catch {
      return false;
    }
  }, "edge");
}

function extractDevCode(apiContainer) {
  const logs = docker(["logs", apiContainer]).stdout;
  const matches = [
    ...logs.matchAll(
      /DEV ONLY admin login code for [^:\r\n]+:\s*(\d{6})/g,
    ),
  ];

  if (matches.length === 0) {
    throw new Error("Dev-only admin login code was not found in API logs.");
  }

  return matches[matches.length - 1][1];
}

function cookieFromResponse(response) {
  const setCookies =
    response.headers.getSetCookie?.() ??
    [response.headers.get("set-cookie") ?? ""];
  const session = setCookies
    .map((value) => value.split(";")[0]?.trim())
    .find((value) => value?.startsWith("zf_admin_session="));

  if (!session) {
    throw new Error("Admin session cookie was not set.");
  }

  return session;
}

function imageSizeBytes(image) {
  return Number(inspect("{{.Size}}", image));
}

function mb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPrivateIpv4(value) {
  const parts = value.split(".").map(Number);

  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

async function waitForCaddyAccessLog(containerId, marker) {
  return waitFor(() => {
    const logs = docker(["logs", containerId], {
      allowFailure: true,
    }).stdout;

    for (const line of logs.split(/\r?\n/)) {
      if (!line.includes(marker)) {
        continue;
      }

      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }

    return null;
  }, "Caddy access log entry for the tunnel probe", 15_000);
}

async function main() {
  envDir = await mkdtemp(path.join(tmpdir(), "zayn-stack-smoke-"));
  envPath = path.join(envDir, ".env");

  const suffix = randomAlphanumeric(8);
  const ownerEmail = `stack-smoke-${suffix}@example.com`;
  const values = createComposeEnvValues({
    POSTGRES_USER: `u${randomAlphanumeric(8)}`,
    POSTGRES_PASSWORD: randomAlphanumeric(32),
    POSTGRES_DB: `db_${randomAlphanumeric(8)}`,
    NODE_ENV: "development",
    APP_ENV: "development",
    EDGE_HOST_PORT: EDGE_PORT,
    NEXT_PUBLIC_API_URL: EDGE,
    NEXT_PUBLIC_MEDIA_BASE_URL: EDGE,
    NEXT_PUBLIC_SITE_URL: EDGE,
    NEXT_PUBLIC_APP_ENV: "development",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "",
    MEDIA_PUBLIC_BASE_URL: EDGE,
    WEB_ORIGIN: EDGE,
    ADMIN_AUTH_SECRET: randomAlphanumeric(48),
    STOREFRONT_API_KEY: randomAlphanumeric(48),
    OWNER_EMAIL: ownerEmail,
    STRIPE_SECRET_KEY: "sk_test_stack_smoke_not_real",
    STRIPE_WEBHOOK_SECRET: "whsec_stack_smoke_not_real",
    RESEND_API_KEY: "",
    EMAIL_FROM: "",
    TWILIO_ACCOUNT_SID: "",
    TWILIO_AUTH_TOKEN: "",
    TWILIO_VERIFY_SERVICE_SID: "",
    APPLE_PAY_DOMAIN_ASSOCIATION: "",
  });

  await writeComposeEnvFile(envPath, values);

  compose(["build"], { inherit: true, timeout: 1_800_000 });
  compose(["up", "-d", "--wait"], {
    inherit: true,
    timeout: 900_000,
  });
  await waitForEdge();
  check("Compose stack starts and the edge responds", true);

  compose(
    [
      "run",
      "--rm",
      "--no-deps",
      "api",
      "node",
      "dist/scripts/seedCategories.js",
    ],
    { timeout: 120_000 },
  );
  check("Compiled category seed command succeeds", true);

  const apiContainer = serviceContainer("api");
  const webContainer = serviceContainer("web");
  const caddyContainer = serviceContainer("edge");
  const postgresContainer = serviceContainer("postgres");
  const migrateContainer = serviceContainer("migrate", true);

  const login = await fetchTimeout(`${EDGE}/admin/login`);
  check(
    "GET /admin/login through the edge returns 200",
    login.status === 200,
    `HTTP ${login.status}`,
  );

  const robots = await fetchTimeout(`${EDGE}/robots.txt`);
  check(
    "GET /robots.txt through the edge returns 200",
    robots.status === 200,
    `HTTP ${robots.status}`,
  );

  check(
    "Plain HTTP does not send HSTS",
    robots.headers.get("strict-transport-security") === null,
    robots.headers.get("strict-transport-security") ?? "absent",
  );

  const secureRobots = await fetchTimeout(`${EDGE}/robots.txt`, {
    headers: {
      "x-forwarded-proto": "https",
      "cf-connecting-ip": "203.0.113.10",
    },
  });
  check(
    "HTTPS-simulated request sends conservative HSTS",
    secureRobots.headers.get("strict-transport-security") ===
      "max-age=300",
    secureRobots.headers.get("strict-transport-security") ?? "absent",
  );

  const cfVisitorRobots = await fetchTimeout(`${EDGE}/robots.txt`, {
    headers: {
      "cf-visitor": '{"scheme":"https"}',
    },
  });
  check(
    "CF-Visitor https also sends HSTS",
    cfVisitorRobots.headers.get("strict-transport-security") ===
      "max-age=300",
    cfVisitorRobots.headers.get("strict-transport-security") ?? "absent",
  );

  const stackNetworkId = docker([
    "network",
    "ls",
    "-q",
    "--filter",
    `label=com.docker.compose.project=${PROJECT}`,
    "--filter",
    "label=com.docker.compose.network=stack",
  ]).stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)[0];
  const gateway = stackNetworkId
    ? docker([
        "network",
        "inspect",
        stackNetworkId,
        "--format",
        "{{range .IPAM.Config}}{{println .Gateway}}{{end}}",
      ]).stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)[0]
    : "";
  check(
    "Compose network gateway is a private address",
    isPrivateIpv4(gateway),
    gateway || "missing",
  );

  const probeMarker = `/__tunnel_probe_${suffix}`;
  const probeResponse = await fetchTimeout(`${EDGE}${probeMarker}`, {
    headers: {
      "cf-connecting-ip": "203.0.113.99",
      "x-forwarded-for": "198.51.100.99",
      "x-real-ip": "198.51.100.98",
      "x-visitor-ip": "198.51.100.97",
      "x-forwarded-proto": "https",
    },
  });
  check(
    "Tunnel probe reaches the edge",
    probeResponse.status === 404,
    `HTTP ${probeResponse.status}`,
  );
  const probeLog = await waitForCaddyAccessLog(
    caddyContainer,
    probeMarker,
  );
  const probeRequest = probeLog.request ?? {};
  check(
    "Host requests to the edge arrive from the Docker gateway",
    probeRequest.remote_ip === gateway,
    `peer=${probeRequest.remote_ip ?? "missing"}, gateway=${gateway || "missing"}`,
  );
  check(
    "Caddy uses CF-Connecting-IP instead of client-supplied X-Forwarded-For",
    probeRequest.client_ip === "203.0.113.99",
    `client=${probeRequest.client_ip ?? "missing"}`,
  );

  const secureSimulationHeaders = {
    "content-type": "application/json",
    "x-forwarded-proto": "https",
    "cf-connecting-ip": "203.0.113.10",
    "x-forwarded-for": "198.51.100.10",
    "x-real-ip": "198.51.100.11",
    "x-visitor-ip": "198.51.100.12",
    "x-admin-session": "forged-session",
    "x-storefront-key": "forged-key",
  };
  const zipBody = JSON.stringify({
    zip: "10001",
    subtotal_cents: 1000,
  });
  const zipStatuses = [];

  for (let index = 0; index < 30; index += 1) {
    const response = await fetchTimeout(`${EDGE}/api/zip-check`, {
      method: "POST",
      headers: secureSimulationHeaders,
      body: zipBody,
    });

    zipStatuses.push(response.status);
  }

  const rateLimited = await fetchTimeout(`${EDGE}/api/zip-check`, {
    method: "POST",
    headers: secureSimulationHeaders,
    body: zipBody,
  });
  check(
    "Per-visitor rate limiter uses the forwarded CF-Connecting-IP",
    rateLimited.status === 429,
    `HTTP ${rateLimited.status} after ${zipStatuses.length} requests`,
  );

  const freshVisitor = await fetchTimeout(`${EDGE}/api/zip-check`, {
    method: "POST",
    headers: {
      ...secureSimulationHeaders,
      "cf-connecting-ip": "203.0.113.20",
    },
    body: zipBody,
  });
  check(
    "A different CF-Connecting-IP gets a separate rate-limit bucket",
    freshVisitor.status === 200,
    `HTTP ${freshVisitor.status}`,
  );

  const spoofedAdminHeaders = await fetchTimeout(
    `${EDGE}/api/admin-proxy/admin/products?page=1&page_size=1`,
    {
      headers: {
        "x-admin-session": "forged-session",
        "x-storefront-key": "forged-key",
      },
    },
  );
  check(
    "Client-supplied admin/storefront headers do not authenticate",
    spoofedAdminHeaders.status === 401,
    `HTTP ${spoofedAdminHeaders.status}`,
  );

  const defaultConfig = compose(["config", "-q"], {
    allowFailure: true,
  });
  check(
    "Default compose config validates",
    defaultConfig.status === 0,
    `exit ${defaultConfig.status}`,
  );

  const defaultServices = captureCompose(["config", "--services"])
    .split(/\r?\n/)
    .filter(Boolean);
  check(
    "Tunnel services stay behind profiles",
    !defaultServices.includes("tunnel") &&
      !defaultServices.includes("quicktunnel") &&
      !defaultServices.includes("tunnel-token-check"),
    defaultServices.join(", "),
  );

  for (const profile of ["tunnel", "quicktunnel"]) {
    const profileServices = captureCompose([
      "--profile",
      profile,
      "config",
      "--services",
    ])
      .split(/\r?\n/)
      .filter(Boolean);
    const expectedService =
      profile === "tunnel" ? "tunnel" : "quicktunnel";
    const otherService =
      profile === "tunnel" ? "quicktunnel" : "tunnel";
    check(
      `${profile} profile includes only its tunnel service`,
      profileServices.includes(expectedService) &&
        profileServices.includes("edge") &&
        !profileServices.includes(otherService),
      profileServices.join(", "),
    );

    const configResult = compose(
      ["--profile", profile, "config", "-q"],
      { allowFailure: true },
    );
    check(
      `${profile} profile compose config validates`,
      configResult.status === 0,
      `exit ${configResult.status}`,
    );
  }

  const badMedia = await fetchTimeout(`${EDGE}/media/bad/path`);
  check(
    "Bad /media path returns 404 from the API",
    badMedia.status === 404,
    `HTTP ${badMedia.status}`,
  );

  const stripeWebhook = await fetchTimeout(`${EDGE}/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  check(
    "Invalid Stripe webhook signature returns 400 from the API",
    stripeWebhook.status === 400,
    `HTTP ${stripeWebhook.status}`,
  );

  const adminPage = await fetchTimeout(`${EDGE}/admin/products`);
  const adminLocation = adminPage.headers.get("location") ?? "";
  check(
    "GET /admin/products without a cookie redirects to /admin/login",
    [302, 303, 307, 308].includes(adminPage.status) &&
      adminLocation.includes("/admin/login"),
    `HTTP ${adminPage.status}`,
  );

  const publicApiAtEdge = await fetchTimeout(
    `${EDGE}/api/public/categories`,
  );
  check(
    "GET /api/public/categories at the edge is not API JSON",
    publicApiAtEdge.status === 404,
    `HTTP ${publicApiAtEdge.status}`,
  );

  for (const [service, port] of [
    ["postgres", "5432"],
    ["api", "4000"],
    ["web", "3000"],
  ]) {
    let published = "";

    try {
      published = captureCompose(["port", service, port]);
    } catch {
      published = "";
    }

    check(
      `${service} has no published host port`,
      published.length === 0 || published.endsWith(":0"),
      published || "none",
    );
  }

  const edgePort = captureCompose(["port", "edge", "80"]);
  check(
    "Only the edge publishes a host port",
    edgePort === `127.0.0.1:${EDGE_PORT}`,
    edgePort,
  );

  const apiUid = docker(["exec", apiContainer, "id", "-u"]).stdout.trim();
  const webUid = docker(["exec", webContainer, "id", "-u"]).stdout.trim();
  const migrateUser = inspect("{{.Config.User}}", migrateContainer);
  check(
    "API runs as non-root",
    apiUid !== "0" && apiUid !== "root",
    `uid=${apiUid}`,
  );
  check(
    "Web runs as non-root",
    webUid !== "0" && webUid !== "root",
    `uid=${webUid}`,
  );
  check(
    "Migrate image user is non-root",
    migrateUser !== "0" && migrateUser !== "root" && migrateUser !== "",
    migrateUser,
  );
  check(
    "Caddy is running",
    Boolean(caddyContainer),
    "caddy:2.11.9",
  );

  compose(
    [
      "run",
      "--rm",
      "--no-deps",
      "api",
      "node",
      "dist/scripts/createOwner.js",
    ],
    { timeout: 120_000 },
  );
  check("Compiled owner creation command succeeds", true);

  const codeRequest = await fetchTimeout(
    `${EDGE}/api/admin-auth/code-request`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: EDGE,
      },
      body: JSON.stringify({ email: ownerEmail }),
    },
  );
  check(
    "Admin code request through the edge succeeds",
    codeRequest.status === 200,
    `HTTP ${codeRequest.status}`,
  );

  const code = await waitFor(
    async () => {
      try {
        return extractDevCode(apiContainer);
      } catch {
        return null;
      }
    },
    "dev-only admin code in API logs",
    20_000,
  );

  const codeVerify = await fetchTimeout(
    `${EDGE}/api/admin-auth/code-verify`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: EDGE,
      },
      body: JSON.stringify({ email: ownerEmail, code }),
    },
  );
  check(
    "Admin code verification through the edge succeeds",
    codeVerify.status === 200,
    `HTTP ${codeVerify.status}`,
  );

  const adminCookie = cookieFromResponse(codeVerify);
  const me = await fetchTimeout(`${EDGE}/api/admin-auth/me`, {
    headers: { cookie: adminCookie },
  });
  check(
    "GET /api/admin-auth/me with the session succeeds",
    me.status === 200,
    `HTTP ${me.status}`,
  );

  const categoryResponse = await fetchTimeout(
    `${EDGE}/api/admin-proxy/admin/categories`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: EDGE,
        cookie: adminCookie,
      },
      body: JSON.stringify({
        name: `Stack smoke category ${suffix}`,
        is_active: true,
      }),
    },
  );
  check(
    "Throwaway category creation through the admin proxy succeeds",
    categoryResponse.status === 201,
    `HTTP ${categoryResponse.status}`,
  );
  const category = await categoryResponse.json();
  const productName = `Stack smoke ${suffix}`;

  const productResponse = await fetchTimeout(
    `${EDGE}/api/admin-proxy/admin/products`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: EDGE,
        cookie: adminCookie,
      },
      body: JSON.stringify({
        name: productName,
        price_cents: 1234,
        sku: `STACK-${suffix}`,
        status: "active",
        category_id: category.id,
      }),
    },
  );
  check(
    "Throwaway product creation through the admin proxy succeeds",
    productResponse.status === 201,
    `HTTP ${productResponse.status}`,
  );
  const product = await productResponse.json();

  const imageBytes = await readFile(
    path.join(
      REPO_ROOT,
      "apps",
      "web",
      "public",
      "images",
      "home",
      "hero-1.jpg",
    ),
  );
  const form = new FormData();
  form.append(
    "files",
    new Blob([imageBytes], { type: "image/jpeg" }),
    "hero-1.jpg",
  );

  const uploadResponse = await fetchTimeout(
    `${EDGE}/api/admin-proxy/admin/products/${product.id}/images`,
    {
      method: "POST",
      headers: {
        origin: EDGE,
        cookie: adminCookie,
      },
      body: form,
    },
    30_000,
  );
  check(
    "Image upload through the admin proxy returns 201",
    uploadResponse.status === 201,
    `HTTP ${uploadResponse.status}`,
  );
  const uploaded = await uploadResponse.json();
  const uploadedImage = Array.isArray(uploaded) ? uploaded[0] : null;

  check(
    "Uploaded image URL uses the stack media base URL",
    typeof uploadedImage?.url === "string" &&
      uploadedImage.url.startsWith(`${EDGE}/media/products/`),
    "media URL matched",
  );

  const imageResponse = await fetchTimeout(uploadedImage.url);
  const imageContentType = imageResponse.headers.get("content-type");
  const imageNosniff =
    imageResponse.headers.get("x-content-type-options") ?? "";
  check(
    "Uploaded image loads through the edge",
    imageResponse.status === 200 &&
      imageContentType === "image/webp" &&
      imageNosniff.toLowerCase().includes("nosniff"),
    `HTTP ${imageResponse.status}, ${imageContentType}, nosniff=${imageNosniff || "missing"}`,
  );

  const heroResponse = await fetchTimeout(
    `${EDGE}/api/admin-proxy/admin/content`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: EDGE,
        cookie: adminCookie,
      },
      body: JSON.stringify({
        type: "hero",
        title: `Stack hero ${suffix}`,
        is_active: false,
      }),
    },
  );
  check(
    "Throwaway hero content creation succeeds",
    heroResponse.status === 201,
    `HTTP ${heroResponse.status}`,
  );
  const hero = await heroResponse.json();

  const heroForm = new FormData();
  heroForm.append(
    "file",
    new Blob([imageBytes], { type: "image/jpeg" }),
    "hero-1.jpg",
  );

  const heroUpload = await fetchTimeout(
    `${EDGE}/api/admin-proxy/admin/content/${hero.id}/image`,
    {
      method: "POST",
      headers: {
        origin: EDGE,
        cookie: adminCookie,
      },
      body: heroForm,
    },
    30_000,
  );
  check(
    "Throwaway hero image upload returns 201",
    heroUpload.status === 201,
    `HTTP ${heroUpload.status}`,
  );

  const heroActivate = await fetchTimeout(
    `${EDGE}/api/admin-proxy/admin/content/${hero.id}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: EDGE,
        cookie: adminCookie,
      },
      body: JSON.stringify({ is_active: true }),
    },
  );
  check(
    "Throwaway hero activation succeeds",
    heroActivate.status === 200,
    `HTTP ${heroActivate.status}`,
  );

  // Cache Components may have a build-time empty catalog cached. Let the
  // storefront revalidate before the real-browser check so it sees this data.
  console.log(
    "Waiting for storefront cache revalidation before browser checks...",
  );
  await new Promise((resolve) => setTimeout(resolve, 65_000));

  const edgeResponse = await fetchTimeout(`${EDGE}/`);
  const edgeBody = await edgeResponse.text();
  check(
    "GET / through the edge returns 200",
    edgeResponse.status === 200,
    `HTTP ${edgeResponse.status}`,
  );
  check(
    "Storefront HTML rendered",
    edgeBody.includes("Zayn Furnishings") && edgeBody.includes("zf-nav"),
    `${edgeBody.length} bytes`,
  );

  await runStackImageChecks({
    baseUrl: EDGE,
    adminCookie,
    productSlug: product.slug,
    categorySlug: category.slug,
    productName,
  });
  check("Real-browser stack image checks pass", true);

  const foreignOrigin = await fetchTimeout(
    `${EDGE}/api/admin-proxy/admin/products`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
        cookie: adminCookie,
      },
      body: "{}",
    },
  );
  check(
    "Foreign Origin mutation returns 403",
    foreignOrigin.status === 403,
    `HTTP ${foreignOrigin.status}`,
  );

  const deleteImage = await fetchTimeout(
    `${EDGE}/api/admin-proxy/admin/products/${product.id}/images/${uploadedImage.id}`,
    {
      method: "DELETE",
      headers: { origin: EDGE, cookie: adminCookie },
    },
  );
  check(
    "Throwaway image deletion succeeds",
    deleteImage.status === 200,
    `HTTP ${deleteImage.status}`,
  );

  const deleteProduct = await fetchTimeout(
    `${EDGE}/api/admin-proxy/admin/products/${product.id}`,
    {
      method: "DELETE",
      headers: { origin: EDGE, cookie: adminCookie },
    },
  );
  check(
    "Throwaway product deletion succeeds",
    deleteProduct.status === 200,
    `HTTP ${deleteProduct.status}`,
  );

  const storedPath = String(uploadedImage.storage_path ?? "");
  const filePath = `/data/media/${storedPath}`;
  const folderPath = `/data/media/products/${product.id}`;
  const removed = docker([
    "exec",
    apiContainer,
    "node",
    "-e",
    `const fs = require('fs'); const file = ${JSON.stringify(filePath)}; const folder = ${JSON.stringify(folderPath)}; if (fs.existsSync(file) || fs.existsSync(folder)) process.exit(1); console.log('removed');`,
  ]);
  check(
    "Deleted media file and empty product folder are gone",
    removed.stdout.trim() === "removed",
    "removed",
  );

  const deleteHero = await fetchTimeout(
    `${EDGE}/api/admin-proxy/admin/content/${hero.id}`,
    {
      method: "DELETE",
      headers: { origin: EDGE, cookie: adminCookie },
    },
  );
  check(
    "Throwaway hero deletion succeeds",
    deleteHero.status === 200,
    `HTTP ${deleteHero.status}`,
  );

  const deleteCategory = await fetchTimeout(
    `${EDGE}/api/admin-proxy/admin/categories/${category.id}`,
    {
      method: "DELETE",
      headers: { origin: EDGE, cookie: adminCookie },
    },
  );
  check(
    "Throwaway category deletion succeeds",
    deleteCategory.status === 200,
    `HTTP ${deleteCategory.status}`,
  );

  compose(["restart", "api"], { timeout: 120_000 });
  await waitForHealthy(apiContainer, "API after restart");
  check("API health recovers after restart", true);

  const categoriesAfterRestart = JSON.parse(
    docker([
      "exec",
      apiContainer,
      "node",
      "-e",
      "fetch('http://127.0.0.1:4000/api/public/categories').then(async (response) => { const body = await response.json(); console.log(JSON.stringify({ status: response.status, count: Array.isArray(body) ? body.length : -1 })); })",
    ]).stdout.trim(),
  );
  check(
    "Seeded category data persisted across the API restart",
    categoriesAfterRestart.status === 200 && categoriesAfterRestart.count > 0,
    `HTTP ${categoriesAfterRestart.status}, categories=${categoriesAfterRestart.count}`,
  );

  const migrateExitCode = inspect(
    "{{.State.ExitCode}}",
    migrateContainer,
  );
  const migrateCount = docker([
    "ps",
    "-a",
    "-q",
    "--filter",
    `label=com.docker.compose.project=${PROJECT}`,
    "--filter",
    "label=com.docker.compose.service=migrate",
  ]).stdout.trim().split(/\r?\n/).filter(Boolean).length;
  check(
    "Migrate completed with code 0",
    migrateExitCode === "0",
    migrateExitCode,
  );
  check(
    "Migrate did not run twice on API restart",
    migrateCount === 1,
    `${migrateCount} migrate container`,
  );

  console.log(`API image size: ${mb(imageSizeBytes(API_IMAGE))}`);
  console.log(`Web image size: ${mb(imageSizeBytes(WEB_IMAGE))}`);
  console.log("PASS: Compose stack smoke test completed.");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (envPath) {
    compose(["down", "-v", "--remove-orphans"], {
      allowFailure: true,
      timeout: 300_000,
    });

    for (const [kind, args] of [
      ["container", ["ps", "-aq", "--filter", `label=com.docker.compose.project=${PROJECT}`]],
      ["network", ["network", "ls", "-q", "--filter", `label=com.docker.compose.project=${PROJECT}`]],
      ["volume", ["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${PROJECT}`]],
    ]) {
      const ids = docker(args, { allowFailure: true })
        .stdout.trim()
        .split(/\r?\n/)
        .filter(Boolean);

      for (const id of ids) {
        if (kind === "container") {
          docker(["rm", "-f", id], { allowFailure: true });
        } else if (kind === "network") {
          docker(["network", "rm", id], { allowFailure: true });
        } else {
          docker(["volume", "rm", "-f", id], { allowFailure: true });
        }
      }
    }
  }

  if (envDir) {
    await rm(envDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
