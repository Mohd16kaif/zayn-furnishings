import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import process from "node:process";
import { buildWebImage } from "./docker-build.mjs";

const API_IMAGE = "zayn-api:local";
const WEB_IMAGE = "zayn-web:local";
const suffix = randomBytes(4).toString("hex");
const network = `zayn-smoke-net-${suffix}`;
const postgresName = `zayn-smoke-db-${suffix}`;
const apiName = `zayn-smoke-api-${suffix}`;
const webName = `zayn-smoke-web-${suffix}`;
const volume = `zayn-smoke-media-${suffix}`;

const dbUser = `u${randomBytes(6).toString("hex")}`;
const dbPassword = randomBytes(18).toString("hex");
const dbName = `db_${randomBytes(6).toString("hex")}`;
const adminSecret = randomBytes(32).toString("hex");
const storefrontKey = randomBytes(32).toString("hex");
const databaseUrl = `postgres://${dbUser}:${dbPassword}@db:5432/${dbName}`;

const createdContainers = [];
const createdNetworks = [];
const createdVolumes = [];

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
    timeout: options.timeout ?? 120_000,
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !options.allowFailure) {
    const detail = options.inherit
      ? ""
      : `\n${(result.stderr || result.stdout || "").trim().slice(0, 2000)}`;
    throw new Error(
      `docker ${args.slice(0, 2).join(" ")} failed with exit code ${result.status}${detail}`,
    );
  }

  return result;
}

function capture(args, options = {}) {
  return docker(args, options).stdout.trim();
}

function check(name, condition, detail = "") {
  if (!condition) {
    throw new Error(
      `FAIL ${name}${detail ? `: ${detail}` : ""}`,
    );
  }

  console.log(`PASS ${name}${detail ? `: ${detail}` : ""}`);
}

function imageExists(image) {
  const result = docker(
    ["image", "inspect", image],
    { allowFailure: true },
  );

  return result.status === 0;
}

function imageSizeBytes(image) {
  return Number(
    capture(["image", "inspect", "--format", "{{.Size}}", image]),
  );
}

function mb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function waitFor(checkFn, label, timeoutMs = 90_000) {
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

async function containerHealth(name) {
  const status = capture(
    [
      "inspect",
      "--format",
      "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
      name,
    ],
    { allowFailure: true },
  );

  return status === "healthy" || status === "running";
}

function containerLogs(name) {
  return capture(["logs", "--tail", "60", name], {
    allowFailure: true,
  });
}

async function fetchWithTimeout(url, timeoutMs = 15_000) {
  return fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "manual",
  });
}

function execNode(container, code) {
  const result = docker([
    "exec",
    container,
    "node",
    "-e",
    code,
  ]);

  return result.stdout.trim();
}

async function main() {
  check("API image exists", imageExists(API_IMAGE), API_IMAGE);
  check("Web image exists before smoke", imageExists(WEB_IMAGE), WEB_IMAGE);

  console.log(
    "Rebuilding the web image with the smoke-test internal API URL http://api:4000",
  );
  buildWebImage({
    publicEnv: {
      NEXT_PUBLIC_API_URL: "http://api:4000",
      NEXT_PUBLIC_MEDIA_BASE_URL: "http://api:4000",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "",
      NEXT_PUBLIC_APP_ENV: "development",
    },
  });

  docker(["network", "create", network]);
  createdNetworks.push(network);

  docker([
    "volume",
    "create",
    volume,
  ]);
  createdVolumes.push(volume);

  docker([
    "run",
    "-d",
    "--name",
    postgresName,
    "--network",
    network,
    "--network-alias",
    "db",
    "-e",
    `POSTGRES_USER=${dbUser}`,
    "-e",
    `POSTGRES_PASSWORD=${dbPassword}`,
    "-e",
    `POSTGRES_DB=${dbName}`,
    "postgres:16",
  ]);
  createdContainers.push(postgresName);

  await waitFor(
    () => {
      const result = docker(
        [
          "exec",
          postgresName,
          "pg_isready",
          "-U",
          dbUser,
          "-d",
          dbName,
        ],
        { allowFailure: true },
      );

      return result.status === 0;
    },
    "throwaway PostgreSQL",
  );
  check("Throwaway PostgreSQL is ready", true);

  const migrationArgs = [
    "run",
    "--rm",
    "--network",
    network,
    "-e",
    `DATABASE_URL=${databaseUrl}`,
    API_IMAGE,
    "node",
    "dist/scripts/migrate.js",
  ];

  docker(migrationArgs);
  check("Compiled migration command succeeds", true);

  docker(migrationArgs);
  check("Compiled migration command is idempotent", true);

  docker([
    "run",
    "--rm",
    "--network",
    network,
    "-e",
    `DATABASE_URL=${databaseUrl}`,
    "-e",
    "DATABASE_SSL=disable",
    "-e",
    "NODE_ENV=development",
    "-e",
    "APP_ENV=development",
    API_IMAGE,
    "node",
    "dist/scripts/seedCategories.js",
  ]);
  check("Compiled category seed command succeeds", true);

  docker([
    "run",
    "-d",
    "--name",
    apiName,
    "--network",
    network,
    "--network-alias",
    "api",
    "-v",
    `${volume}:/data/media`,
    "-e",
    "APP_ENV=development",
    "-e",
    `DATABASE_URL=${databaseUrl}`,
    "-e",
    "DATABASE_SSL=disable",
    "-e",
    `ADMIN_AUTH_SECRET=${adminSecret}`,
    "-e",
    "MEDIA_DIR=/data/media",
    "-e",
    "MEDIA_PUBLIC_BASE_URL=http://localhost:4000",
    "-e",
    `STOREFRONT_API_KEY=${storefrontKey}`,
    "-e",
    "STRIPE_SECRET_KEY=sk_test_smoke_not_real",
    "-e",
    "STRIPE_WEBHOOK_SECRET=whsec_smoke_not_real",
    API_IMAGE,
  ]);
  createdContainers.push(apiName);

  await waitFor(() => containerHealth(apiName), "API healthcheck");
  check("API container is healthy", true);

  const health = JSON.parse(
    execNode(
      apiName,
      "fetch('http://127.0.0.1:4000/health').then(async (response) => { console.log(JSON.stringify({ status: response.status, body: await response.json() })); })",
    ),
  );
  check(
    "GET /health returns db:true",
    health.status === 200 && health.body?.db === true,
    `HTTP ${health.status}, db=${String(health.body?.db)}`,
  );

  const categories = JSON.parse(
    execNode(
      apiName,
      "fetch('http://127.0.0.1:4000/api/public/categories').then(async (response) => { const body = await response.json(); console.log(JSON.stringify({ status: response.status, count: Array.isArray(body) ? body.length : -1 })); })",
    ),
  );
  check(
    "GET /api/public/categories works",
    categories.status === 200 && categories.count > 0,
    `HTTP ${categories.status}, categories=${categories.count}`,
  );

  const badMediaStatus = Number(
    execNode(
      apiName,
      "fetch('http://127.0.0.1:4000/media/not-a-valid-path').then((response) => { console.log(response.status); })",
    ),
  );
  check(
    "Bad /media path returns 404",
    badMediaStatus === 404,
    `HTTP ${badMediaStatus}`,
  );

  const uid = capture(["exec", apiName, "id", "-u"]);
  check("API container runs as non-root", uid !== "0", `uid=${uid}`);

  const writeResult = execNode(
    apiName,
    "const fs = require('fs'); fs.writeFileSync('/data/media/smoke-check.txt', 'ok'); fs.unlinkSync('/data/media/smoke-check.txt'); console.log('ok');",
  );
  check("API user can write to /data/media", writeResult === "ok");

  const sharpBytes = Number(
    execNode(
      apiName,
      "const sharp = require('sharp'); sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } }).resize(4, 4).webp().toBuffer().then((buffer) => { console.log(buffer.length); });",
    ),
  );
  check("sharp resize works inside the API image", sharpBytes > 0, `${sharpBytes} bytes`);

  const sharedPath = execNode(
    apiName,
    "console.log(require.resolve('@zayn/shared'));",
  );
  check(
    "API image contains @zayn/shared",
    sharedPath.length > 0,
    sharedPath,
  );

  const webSharedPath = capture([
    "run",
    "--rm",
    "--entrypoint",
    "node",
    WEB_IMAGE,
    "-e",
    "console.log(require.resolve('@zayn/shared'));",
  ], { allowFailure: true });
  const webSharpPath = capture([
    "run",
    "--rm",
    "--workdir",
    "/app/apps/web",
    "--entrypoint",
    "node",
    WEB_IMAGE,
    "-e",
    "const nextPackage = require.resolve('next/package.json'); console.log(require.resolve('sharp', { paths: [nextPackage] }));",
  ], { allowFailure: true });
  check(
    "Web standalone output contains @zayn/shared",
    webSharedPath.length > 0,
    webSharedPath,
  );
  check(
    "Web standalone output contains sharp",
    webSharpPath.length > 0,
    webSharpPath,
  );

  docker([
    "run",
    "-d",
    "--name",
    webName,
    "--network",
    network,
    "-p",
    "127.0.0.1::3000",
    "-e",
    `STOREFRONT_API_KEY=${storefrontKey}`,
    "-e",
    "APPLE_PAY_DOMAIN_ASSOCIATION=",
    WEB_IMAGE,
  ]);
  createdContainers.push(webName);

  await waitFor(() => containerHealth(webName), "web healthcheck");
  check("Web container is healthy", true);

  const webAddress = capture(["port", webName, "3000/tcp"])
    .split(/\r?\n/)[0]
    .trim();
  const webPort = webAddress.split(":").pop();
  check("Web host port is published", Boolean(webPort), webPort);
  const webBase = `http://127.0.0.1:${webPort}`;

  const home = await fetchWithTimeout(`${webBase}/`);
  const homeBody = await home.text();
  check("GET / returns 200", home.status === 200, `HTTP ${home.status}`);
  check(
    "Cache Components home page rendered under standalone",
    homeBody.includes("Zayn Furnishings") && homeBody.includes("zf-nav"),
    `${homeBody.length} bytes`,
  );

  const login = await fetchWithTimeout(`${webBase}/admin/login`);
  const loginBody = await login.text();
  check(
    "GET /admin/login returns 200",
    login.status === 200,
    `HTTP ${login.status}`,
  );
  check(
    "Admin login page rendered under standalone",
    loginBody.toLowerCase().includes("admin"),
    `${loginBody.length} bytes`,
  );

  const robots = await fetchWithTimeout(`${webBase}/robots.txt`);
  const robotsBody = await robots.text();
  check(
    "GET /robots.txt works",
    robots.status === 200 && robotsBody.length > 0,
    `HTTP ${robots.status}`,
  );

  const secretPattern =
    /(SECRET|TOKEN|PASSWORD|DATABASE_URL|STRIPE|RESEND|TWILIO|STOREFRONT|ADMIN_AUTH|NEXT_PUBLIC_)/i;

  for (const [label, image] of [
    ["API", API_IMAGE],
    ["Web", WEB_IMAGE],
  ]) {
    const envOutput = capture([
      "run",
      "--rm",
      "--entrypoint",
      "env",
      image,
    ]);
    const suspicious = envOutput
      .split(/\r?\n/)
      .map((line) => line.split("=")[0]?.trim())
      .filter((key) => key && secretPattern.test(key));

    check(
      `${label} image contains no secret-looking environment variables`,
      suspicious.length === 0,
      suspicious.join(", ") || "none",
    );

    const envFiles = capture([
      "run",
      "--rm",
      "--entrypoint",
      "sh",
      image,
      "-c",
      "find /app -path /app/node_modules -prune -o -name '.env*' -print",
    ]);

    check(
      `${label} image contains no .env files`,
      envFiles.length === 0,
      envFiles || "none",
    );
  }

  console.log(`API image size: ${mb(imageSizeBytes(API_IMAGE))}`);
  console.log(`Web image size: ${mb(imageSizeBytes(WEB_IMAGE))}`);
  console.log("PASS: Docker smoke test completed.");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));

  for (const name of [apiName, webName]) {
    if (createdContainers.includes(name)) {
      const logs = containerLogs(name);

      if (logs) {
        console.error(`--- ${name} logs ---\n${logs}`);
      }
    }
  }

  process.exitCode = 1;
} finally {
  for (const name of createdContainers.reverse()) {
    docker(["rm", "-f", name], { allowFailure: true });
  }

  for (const name of createdNetworks.reverse()) {
    docker(["network", "rm", name], { allowFailure: true });
  }

  for (const name of createdVolumes.reverse()) {
    docker(["volume", "rm", "-f", name], { allowFailure: true });
  }
}
