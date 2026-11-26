import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createComposeEnvValues,
  randomAlphanumeric,
  writeComposeEnvFile,
} from "./compose-init-env.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const COMPOSE_FILE = "docker-compose.stack.yml";
const PROJECT = "zayn-drill";
const EDGE_PORT = "18081";
const EDGE = `http://localhost:${EDGE_PORT}`;
const API_IMAGE = "zayn-api:stack";
const BACKUP_IMAGE = "zayn-backup:stack";
const DB_IMAGE = "postgres:16";

let envDir = null;
let envPath = null;
let values = null;
let secretValues = [];
let passCount = 0;
let failCount = 0;
let firstSummary = null;
let secondSummary = null;

const captured = [];
const extraContainers = [];
const extraVolumes = [];

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
    timeout: options.timeout ?? 120_000,
    shell: false,
    env: options.env ?? process.env,
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
    {
      ...options,
      env: {
        ...process.env,
        COMPOSE_ENV_FILE: envPath,
      },
    },
  );
}

function captureCompose(args, options = {}) {
  return compose(args, options);
}

function check(name, condition, detail = "") {
  if (!condition) {
    failCount += 1;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
    throw new Error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  }

  passCount += 1;
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
  ]).stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)[0];

  if (!id) {
    throw new Error(`No container found for compose service ${service}.`);
  }

  return id;
}

function inspect(format, target) {
  return docker(["inspect", "--format", format, target]).stdout.trim();
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

function safeTail(result) {
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return text
    .split(/\r?\n/)
    .filter(
      (line) =>
        line &&
        !secretValues.some((secret) => secret && line.includes(secret)),
    )
    .slice(-15)
    .join("\n");
}

function assertNoSecrets(label, text) {
  for (const secret of secretValues) {
    if (secret && text.includes(secret)) {
      throw new Error(
        `FAIL ${label}: a secret value appeared in captured output`,
      );
    }
  }

  check(`${label} contains no backup or application secrets`, true);
}

function remember(label, result) {
  const entry = {
    label,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };

  captured.push(entry);
  return entry;
}

function runBackup(command, args = [], extraOptions = []) {
  const result = compose(
    [
      "--profile",
      "backup",
      "run",
      "--rm",
      "--no-deps",
      ...extraOptions,
      "backup",
      command,
      ...args,
    ],
    { allowFailure: true, timeout: 60 * 60 * 1000 },
  );

  remember(`backup:${command}`, result);
  return result;
}

function parseBackupSummary(result) {
  const line = `${result.stdout ?? ""}`
    .split(/\r?\n/)
    .reverse()
    .find((entry) => entry.startsWith("BACKUP_SUMMARY "));

  if (!line) {
    throw new Error(
      `Backup did not print a summary. ${safeTail(result)}`.trim(),
    );
  }

  return JSON.parse(line.slice("BACKUP_SUMMARY ".length));
}

function parseSnapshots(result) {
  const text = `${result.stdout ?? ""}`.trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");

  if (start === -1 || end === -1 || end < start) {
    throw new Error("The restic snapshot list was not valid JSON.");
  }

  return JSON.parse(text.slice(start, end + 1));
}

function composeVolumeName(key) {
  const result = docker([
    "volume",
    "ls",
    "-q",
    "--filter",
    `label=com.docker.compose.project=${PROJECT}`,
    "--filter",
    `label=com.docker.compose.volume=${key}`,
  ]);
  const name = result.stdout.trim().split(/\r?\n/).filter(Boolean)[0];

  if (!name) {
    throw new Error(`Could not find the ${key} Docker volume.`);
  }

  return name;
}

function psql(pgContainer, user, database, sql) {
  const result = docker([
    "exec",
    pgContainer,
    "psql",
    "-U",
    user,
    "-d",
    database,
    "-A",
    "-t",
    "-F",
    "\t",
    "-c",
    sql,
  ]);

  if (result.status !== 0) {
    throw new Error("psql query failed.");
  }

  return result.stdout;
}

function tableCounts(pgContainer, user, database) {
  const sql = `
SELECT table_schema || '.' || table_name AS table_name, c
FROM (
  SELECT table_schema, table_name,
    (xpath(
      '/row/c/text()',
      query_to_xml(
        format('select count(*) as c from %I.%I', table_schema, table_name),
        false, true, ''
      )
    ))[1]::text::bigint AS c
  FROM information_schema.tables
  WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    AND table_type = 'BASE TABLE'
) AS counts
WHERE c > 0
ORDER BY table_name;
`.trim();

  const output = psql(pgContainer, user, database, sql);
  const counts = new Map();

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const [name, count] = line.split("\t");
    counts.set(name, Number(count));
  }

  return counts;
}

function sameCounts(left, right) {
  const leftKeys = [...left.keys()].sort();
  const rightKeys = [...right.keys()].sort();

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index];

    if (key !== rightKeys[index] || left.get(key) !== right.get(key)) {
      return false;
    }
  }

  return true;
}

function sha256InApiContainer(apiContainer, filePath) {
  const script = `
const fs = require("fs");
const crypto = require("crypto");
const buffer = fs.readFileSync(${JSON.stringify(filePath)});
console.log(crypto.createHash("sha256").update(buffer).digest("hex"));
`.trim();
  const result = docker(["exec", apiContainer, "node", "-e", script]);

  if (result.status !== 0) {
    throw new Error("Could not hash the uploaded media file.");
  }

  return result.stdout.trim();
}

function sha256InVolume(volume, filePath) {
  const result = docker([
    "run",
    "--rm",
    "-v",
    `${volume}:/data/media`,
    "alpine:3.20",
    "sha256sum",
    `/data/media/${filePath}`,
  ]);

  if (result.status !== 0) {
    throw new Error("Could not hash the restored media file.");
  }

  return result.stdout.trim().split(/\s+/)[0];
}

async function createRestoreTarget(suffix) {
  const network = docker([
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

  if (!network) {
    throw new Error("The drill stack network was not found.");
  }

  const pgName = `zayn-drill-restore-pg-${suffix}`;
  const pgAlias = `drill-restore-pg-${suffix}`;
  const pgVolume = `zayn-drill-restore-pgdata-${suffix}`;
  const mediaVolume = `zayn-drill-restore-media-${suffix}`;

  docker(["volume", "create", pgVolume]);
  extraVolumes.push(pgVolume);
  docker(["volume", "create", mediaVolume]);
  extraVolumes.push(mediaVolume);

  const pg = docker([
    "run",
    "-d",
    "--name",
    pgName,
    "--network",
    network,
    "--network-alias",
    pgAlias,
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "-e",
    "POSTGRES_USER=restore",
    "-e",
    "POSTGRES_DB=restored",
    "-v",
    `${pgVolume}:/var/lib/postgresql/data`,
    DB_IMAGE,
  ]);

  if (pg.status !== 0) {
    throw new Error("Could not start the throwaway PostgreSQL container.");
  }

  extraContainers.push(pgName);
  await waitFor(
    () =>
      docker(
        ["exec", pgName, "pg_isready", "-U", "restore", "-d", "restored"],
        { allowFailure: true },
      ).status === 0,
    "the throwaway PostgreSQL container",
    90_000,
  );

  return { pgName, pgAlias, pgVolume, mediaVolume };
}

async function main() {
  envDir = await mkdtemp(path.join(tmpdir(), "zayn-backup-drill-"));
  envPath = path.join(envDir, ".env");

  const suffix = randomAlphanumeric(8);
  const ownerEmail = `backup-drill-${suffix}@example.com`;
  const resticPassword = randomAlphanumeric(64);
  const wrongPassword = randomAlphanumeric(32);

  values = createComposeEnvValues({
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
    STRIPE_SECRET_KEY: "sk_test_backup_drill_not_real",
    STRIPE_WEBHOOK_SECRET: "whsec_backup_drill_not_real",
    RESEND_API_KEY: "",
    EMAIL_FROM: "",
    TWILIO_ACCOUNT_SID: "",
    TWILIO_AUTH_TOKEN: "",
    TWILIO_VERIFY_SERVICE_SID: "",
    APPLE_PAY_DOMAIN_ASSOCIATION: "",
    RESTIC_REPOSITORY: "/repo",
    RESTIC_PASSWORD: resticPassword,
    AWS_ACCESS_KEY_ID: "",
    AWS_SECRET_ACCESS_KEY: "",
    AWS_DEFAULT_REGION: "",
    BACKUP_KEEP_DAILY: "1",
    BACKUP_KEEP_WEEKLY: "1",
    BACKUP_KEEP_MONTHLY: "1",
    BACKUP_READ_DATA_SUBSET: "1/10",
    HEALTHCHECK_PING_URL: "",
  });

  secretValues = [
    values.RESTIC_PASSWORD,
    values.POSTGRES_PASSWORD,
    values.ADMIN_AUTH_SECRET,
    values.STOREFRONT_API_KEY,
    wrongPassword,
  ].filter(Boolean);

  await writeComposeEnvFile(envPath, values);

  console.log("Building the drill stack images...");
  compose(["--profile", "backup", "build"], {
    inherit: true,
    timeout: 30 * 60 * 1000,
  });

  console.log("Starting the drill stack...");
  compose(["up", "-d", "--wait"], {
    inherit: true,
    timeout: 15 * 60 * 1000,
  });
  await waitForEdge();
  check("Drill stack starts and the edge responds", true);

  compose(
    ["run", "--rm", "--no-deps", "api", "node", "dist/scripts/seedCategories.js"],
    { inherit: true, timeout: 120_000 },
  );
  compose(
    ["run", "--rm", "--no-deps", "api", "node", "dist/scripts/createOwner.js"],
    { inherit: true, timeout: 120_000 },
  );
  check("Seed categories and create the owner", true);

  const apiContainer = serviceContainer("api");
  const postgresContainer = serviceContainer("postgres");

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
        name: `Drill category ${suffix}`,
        is_active: true,
      }),
    },
  );
  check(
    "Create a throwaway category",
    categoryResponse.status === 201,
    `HTTP ${categoryResponse.status}`,
  );
  const category = await categoryResponse.json();

  const productName = `Drill product ${suffix}`;
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
        sku: `DRILL-${suffix}`,
        status: "active",
        category_id: category.id,
      }),
    },
  );
  check(
    "Create an active product",
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
    "Upload hero-1.jpg to the product",
    uploadResponse.status === 201,
    `HTTP ${uploadResponse.status}`,
  );
  const uploaded = await uploadResponse.json();
  const uploadedImage = Array.isArray(uploaded) ? uploaded[0] : null;

  if (!uploadedImage?.storage_path) {
    throw new Error("The upload response did not include storage_path.");
  }

  const storagePath = String(uploadedImage.storage_path);
  const mediaPath = `/data/media/${storagePath}`;
  const mediaSha256 = sha256InApiContainer(apiContainer, mediaPath);
  check(
    "Uploaded media file is readable and hashed",
    /^[0-9a-f]{64}$/.test(mediaSha256),
    `sha256 ${mediaSha256.slice(0, 12)}...`,
  );

  const beforeCounts = tableCounts(
    postgresContainer,
    values.POSTGRES_USER,
    values.POSTGRES_DB,
  );
  const beforeMigrations =
    beforeCounts.get("drizzle.__drizzle_migrations") ?? 0;
  check(
    "Recorded row counts before the backup",
    beforeCounts.size > 0 && beforeMigrations > 0,
    `${beforeCounts.size} tables with rows, ${beforeMigrations} migrations`,
  );

  console.log("Running the first backup...");
  const firstResult = runBackup("backup");
  check(
    "First backup exits successfully",
    firstResult.status === 0,
    `exit ${firstResult.status}${firstResult.status === 0 ? "" : `: ${safeTail(firstResult)}`}`,
  );
  firstSummary = parseBackupSummary(firstResult);
  check(
    "First backup reports db and media snapshot ids",
    Boolean(firstSummary.db_snapshot && firstSummary.media_snapshot),
    `db ${firstSummary.db_snapshot?.slice(0, 8)}, media ${firstSummary.media_snapshot?.slice(0, 8)}`,
  );
  check(
    "First backup includes the database and media bytes",
    firstSummary.dump_bytes > 0 && firstSummary.media_bytes > 0,
    `database ${firstSummary.dump_bytes}B, media ${firstSummary.media_bytes}B`,
  );

  const firstSnapshots = parseSnapshots(runBackup("snapshots-json"));
  const firstDbSnapshot = firstSnapshots.find(
    (snapshot) => snapshot.id === firstSummary.db_snapshot,
  );
  const firstMediaSnapshot = firstSnapshots.find(
    (snapshot) => snapshot.id === firstSummary.media_snapshot,
  );
  check(
    "First backup snapshots carry db/media and the shared run tag",
    Boolean(
      firstDbSnapshot?.tags?.includes("db") &&
        firstMediaSnapshot?.tags?.includes("media") &&
        firstDbSnapshot?.tags?.includes(firstSummary.run_tag) &&
        firstMediaSnapshot?.tags?.includes(firstSummary.run_tag),
    ),
    `run ${firstSummary.run_tag}`,
  );

  await new Promise((resolve) => setTimeout(resolve, 1_100));

  console.log("Running the second backup...");
  const secondResult = runBackup("backup");
  check(
    "Second backup exits successfully",
    secondResult.status === 0,
    `exit ${secondResult.status}${secondResult.status === 0 ? "" : `: ${safeTail(secondResult)}`}`,
  );
  secondSummary = parseBackupSummary(secondResult);

  const firstAdded = firstSummary.db_added + firstSummary.media_added;
  const secondAdded = secondSummary.db_added + secondSummary.media_added;
  check(
    "Second backup is deduplicated and much smaller",
    secondAdded < firstAdded &&
      secondSummary.media_added <
        Math.max(firstSummary.media_added, 1),
    `first added ${firstAdded}B, second added ${secondAdded}B, media second added ${secondSummary.media_added}B`,
  );

  const secondSnapshots = parseSnapshots(runBackup("snapshots-json"));
  const retainedFirst = secondSnapshots.filter((snapshot) =>
    snapshot.tags?.includes(firstSummary.run_tag),
  );
  const retainedSecond = secondSnapshots.filter((snapshot) =>
    snapshot.tags?.includes(secondSummary.run_tag),
  );
  check(
    "Retention pruned the older run and kept the newest snapshots",
    retainedFirst.length === 0 &&
      retainedSecond.some((snapshot) => snapshot.tags?.includes("db")) &&
      retainedSecond.some((snapshot) => snapshot.tags?.includes("media")),
    `old snapshots ${retainedFirst.length}, new snapshots ${retainedSecond.length}`,
  );

  console.log("Corrupting the live product row and media file...");
  psql(
    postgresContainer,
    values.POSTGRES_USER,
    values.POSTGRES_DB,
    `DELETE FROM products WHERE id = '${product.id}'`,
  );
  docker(["exec", apiContainer, "rm", "-f", mediaPath]);

  const productCount = Number(
    psql(
      postgresContainer,
      values.POSTGRES_USER,
      values.POSTGRES_DB,
      `SELECT count(*) FROM products WHERE id = '${product.id}'`,
    ).trim(),
  );
  const mediaGone = docker(
    ["exec", apiContainer, "test", "!", "-e", mediaPath],
    { allowFailure: true },
  );
  check(
    "Live product row and media file were deleted",
    productCount === 0 && mediaGone.status === 0,
    "product row 0, media file absent",
  );

  const restoreSuffix = randomBytes(4).toString("hex");
  const restore = await createRestoreTarget(restoreSuffix);
  const restoreDbResult = runBackup(
    "restore-db",
    [secondSummary.db_snapshot, "restored"],
    [
      "-e",
      `PGHOST=${restore.pgAlias}`,
      "-e",
      "PGUSER=restore",
      "-e",
      "PGDATABASE=restored",
      "-e",
      "PGPASSWORD=",
    ],
  );
  check(
    "Database restore into a fresh PostgreSQL container succeeds",
    restoreDbResult.status === 0,
    `exit ${restoreDbResult.status}${restoreDbResult.status === 0 ? "" : `: ${safeTail(restoreDbResult)}`}`,
  );

  const restoreMediaResult = runBackup(
    "restore-media",
    [secondSummary.media_snapshot],
    ["-v", `${restore.mediaVolume}:/restore-target`],
  );
  check(
    "Media restore into a fresh volume succeeds",
    restoreMediaResult.status === 0,
    `exit ${restoreMediaResult.status}${restoreMediaResult.status === 0 ? "" : `: ${safeTail(restoreMediaResult)}`}`,
  );

  const afterCounts = tableCounts(
    restore.pgName,
    "restore",
    "restored",
  );
  const afterMigrations =
    afterCounts.get("drizzle.__drizzle_migrations") ?? 0;
  check(
    "Restored row counts and migration count match every table",
    sameCounts(beforeCounts, afterCounts) &&
      beforeMigrations === afterMigrations,
    `${afterCounts.size} tables with rows, ${afterMigrations} migrations`,
  );

  const restoredSha256 = sha256InVolume(
    restore.mediaVolume,
    storagePath,
  );
  check(
    "Restored media file has the same sha256",
    restoredSha256 === mediaSha256,
    `sha256 ${restoredSha256.slice(0, 12)}...`,
  );

  const restoreApiName = `zayn-drill-restore-api-${restoreSuffix}`;
  const restoreApi = docker([
    "run",
    "-d",
    "--name",
    restoreApiName,
    "--network",
    docker([
      "network",
      "ls",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${PROJECT}`,
      "--filter",
      "label=com.docker.compose.network=stack",
    ]).stdout.trim().split(/\r?\n/).filter(Boolean)[0],
    "-e",
    `DATABASE_URL=postgres://restore@${restore.pgAlias}:5432/restored`,
    "-e",
    "DATABASE_SSL=disable",
    "-e",
    "NODE_ENV=development",
    "-e",
    "APP_ENV=development",
    "-e",
    `ADMIN_AUTH_SECRET=${values.ADMIN_AUTH_SECRET}`,
    "-e",
    `STOREFRONT_API_KEY=${values.STOREFRONT_API_KEY}`,
    "-e",
    "MEDIA_DIR=/data/media",
    "-e",
    `MEDIA_PUBLIC_BASE_URL=${EDGE}`,
    "-e",
    `WEB_ORIGIN=${EDGE}`,
    "-v",
    `${restore.mediaVolume}:/data/media`,
    API_IMAGE,
  ]);

  if (restoreApi.status !== 0) {
    throw new Error("Could not start the API against the restored data.");
  }

  extraContainers.push(restoreApiName);
  await waitForHealthy(restoreApiName, "the restored API container");

  const health = JSON.parse(
    docker([
      "exec",
      restoreApiName,
      "node",
      "-e",
      "fetch('http://127.0.0.1:4000/health').then((response) => response.json()).then((body) => console.log(JSON.stringify(body)))",
    ]).stdout.trim(),
  );
  check(
    "Restored API reports db:true",
    health.db === true,
    `db=${String(health.db)}`,
  );

  const products = JSON.parse(
    docker([
      "exec",
      restoreApiName,
      "node",
      "-e",
      "fetch('http://127.0.0.1:4000/api/public/products').then((response) => response.json()).then((body) => console.log(JSON.stringify(body)))",
    ]).stdout.trim(),
  );
  check(
    "Public products endpoint shows the restored product",
    JSON.stringify(products).includes(product.slug),
    `slug ${product.slug}`,
  );

  const mediaResponse = JSON.parse(
    docker([
      "exec",
      restoreApiName,
      "node",
      "-e",
      `fetch('http://127.0.0.1:4000/media/${storagePath}').then(async (response) => { const buffer = Buffer.from(await response.arrayBuffer()); const crypto = require('crypto'); console.log(JSON.stringify({ status: response.status, type: response.headers.get('content-type'), hash: crypto.createHash('sha256').update(buffer).digest('hex') })); })`,
    ]).stdout.trim(),
  );
  check(
    "Restored media URL returns 200 image/webp with the same sha256",
    mediaResponse.status === 200 &&
      mediaResponse.type === "image/webp" &&
      mediaResponse.hash === mediaSha256,
    `HTTP ${mediaResponse.status}, ${mediaResponse.type}, sha256 ${String(mediaResponse.hash).slice(0, 12)}...`,
  );

  console.log("Running failure tests...");
  const wrongPasswordResult = runBackup("backup", [], [
    "-e",
    `RESTIC_PASSWORD=${wrongPassword}`,
  ]);
  const wrongPasswordText = `${wrongPasswordResult.stdout ?? ""}\n${wrongPasswordResult.stderr ?? ""}`;
  check(
    "Wrong RESTIC_PASSWORD fails loudly without printing the password",
    wrongPasswordResult.status !== 0 &&
      /RESTIC_PASSWORD|restic repository|wrong password/i.test(
        wrongPasswordText,
      ) &&
      !wrongPasswordText.includes(wrongPassword) &&
      !wrongPasswordText.includes(resticPassword),
    `exit ${wrongPasswordResult.status}`,
  );

  const unreachableRepoResult = runBackup("backup", [], [
    "-e",
    "RESTIC_REPOSITORY=/nonexistent-dir/repo",
  ]);
  const unreachableText = `${unreachableRepoResult.stdout ?? ""}\n${unreachableRepoResult.stderr ?? ""}`;
  check(
    "An unreachable or unwritable repository fails loudly",
    unreachableRepoResult.status !== 0 &&
      !secretValues.some((secret) => secret && unreachableText.includes(secret)),
    `exit ${unreachableRepoResult.status}`,
  );

  const majorMismatch = docker(
    [
      "run",
      "--rm",
      "--entrypoint",
      "bash",
      BACKUP_IMAGE,
      "-c",
      "source /usr/local/bin/zayn-backup; CURRENT_STEP='pg major version self-test'; PG_DUMP_MAJOR=15; SERVER_MAJOR=16; assert_major_match; echo SHOULD_NOT_PASS",
    ],
    { allowFailure: true },
  );
  const majorText = `${majorMismatch.stdout ?? ""}\n${majorMismatch.stderr ?? ""}`;
  check(
    "A pg_dump/server major mismatch is rejected",
    majorMismatch.status !== 0 &&
      /does not match/i.test(majorText) &&
      !majorText.includes("SHOULD_NOT_PASS"),
    `exit ${majorMismatch.status}`,
  );

  const sourceRepoVolume = composeVolumeName("backup-repo");
  const corruptVolume = `zayn-drill-corrupt-repo-${restoreSuffix}`;
  docker(["volume", "create", corruptVolume]);
  extraVolumes.push(corruptVolume);
  docker([
    "run",
    "--rm",
    "-v",
    `${sourceRepoVolume}:/src:ro`,
    "-v",
    `${corruptVolume}:/dst`,
    "alpine:3.20",
    "sh",
    "-c",
    'cp -a /src/. /dst/ && f="$(find /dst/data -type f | head -n 1)" && printf X >> "$f" && echo corrupted',
  ]);
  const corruptResult = runBackup("check", [], [
    "-e",
    "RESTIC_REPOSITORY=/corrupt-repo",
    "-v",
    `${corruptVolume}:/corrupt-repo`,
  ]);
  const corruptText = `${corruptResult.stdout ?? ""}\n${corruptResult.stderr ?? ""}`;
  check(
    "A corrupted pack file makes restic check fail",
    corruptResult.status !== 0 &&
      !secretValues.some((secret) => secret && corruptText.includes(secret)),
    `exit ${corruptResult.status}`,
  );

  const statusResult = runBackup("status");
  const statusText = `${statusResult.stdout ?? ""}`;
  check(
    "Status file is readable",
    statusResult.status === 0 &&
      statusText.includes(secondSummary.db_snapshot) &&
      statusText.includes(secondSummary.media_snapshot),
    "db and media snapshot ids present",
  );

  for (const entry of captured) {
    assertNoSecrets(
      `Captured ${entry.label} output`,
      `${entry.stdout}\n${entry.stderr}`,
    );
  }

  const inspectRun = captureCompose([
    "--profile",
    "backup",
    "run",
    "-d",
    "--rm",
    "--no-deps",
    "--entrypoint",
    "sh",
    "backup",
    "-c",
    "sleep 60",
  ]);
  check(
    "Inspect container starts",
    inspectRun.status === 0,
    `exit ${inspectRun.status}`,
  );
  const inspectId = docker([
    "ps",
    "-q",
    "--filter",
    `label=com.docker.compose.project=${PROJECT}`,
    "--filter",
    "label=com.docker.compose.service=backup",
  ]).stdout.trim().split(/\r?\n/).filter(Boolean)[0];

  if (!inspectId) {
    throw new Error("Could not find the running backup container.");
  }

  try {
    const inspectUser = inspect("{{.Config.User}}", inspectId);
    const inspectMounts = JSON.parse(
      inspect("{{json .Mounts}}", inspectId) || "[]",
    );
    const inspectReadOnly = inspect(
      "{{.HostConfig.ReadonlyRootfs}}",
      inspectId,
    );
    const inspectCaps = JSON.parse(
      inspect("{{json .HostConfig.CapDrop}}", inspectId) || "[]",
    );
    const inspectSecurity = JSON.parse(
      inspect("{{json .HostConfig.SecurityOpt}}", inspectId) || "[]",
    );
    const inspectPorts = JSON.parse(
      inspect("{{json .HostConfig.PortBindings}}", inspectId) || "{}",
    );
    const mediaMount = inspectMounts.find(
      (mount) => mount.Destination === "/data/media",
    );

    check(
      "Backup container runs as non-root",
      inspectUser !== "0" && inspectUser !== "root" && inspectUser !== "",
      `user ${inspectUser}`,
    );
    check(
      "Backup container mounts media read-only",
      mediaMount && mediaMount.RW === false,
      mediaMount ? `RW=${mediaMount.RW}` : "media mount missing",
    );
    check(
      "Backup container drops all capabilities and sets no-new-privileges",
      inspectCaps.includes("ALL") &&
        inspectSecurity.includes("no-new-privileges:true"),
      `caps ${inspectCaps.join(",")}, security ${inspectSecurity.join(",")}`,
    );
    check(
      "Backup container root is read-only and it publishes no ports",
      inspectReadOnly === "true" &&
        Object.keys(inspectPorts ?? {}).length === 0,
      `readonly=${inspectReadOnly}, ports=${Object.keys(inspectPorts ?? {}).length}`,
    );
  } finally {
    docker(["rm", "-f", inspectId], { allowFailure: true });
  }

  console.log("");
  console.log("Backup drill summary");
  console.log(
    `  First backup: ${firstSummary.dump_bytes}B database, ${firstSummary.media_bytes}B media, ${firstSummary.duration_ms}ms, added ${firstAdded}B`,
  );
  console.log(
    `  Second backup: ${secondSummary.dump_bytes}B database, ${secondSummary.media_bytes}B media, ${secondSummary.duration_ms}ms, added ${secondAdded}B`,
  );
  console.log(
    `  Dedup: second backup added ${secondAdded}B versus ${firstAdded}B for the first`,
  );
  console.log(
    `  Restore pair: ${secondSummary.run_tag} (db ${secondSummary.db_snapshot.slice(0, 8)}, media ${secondSummary.media_snapshot.slice(0, 8)})`,
  );
  console.log("  Failure tests: wrong password, unreachable repository, pg major mismatch, corrupt pack");
  console.log("  PASS: backup drill completed.");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (envPath) {
    for (const container of extraContainers) {
      docker(["rm", "-f", container], { allowFailure: true });
    }

    compose(["--profile", "backup", "down", "-v", "--remove-orphans"], {
      allowFailure: true,
      timeout: 5 * 60 * 1000,
    });

    for (const volume of extraVolumes) {
      docker(["volume", "rm", "-f", volume], { allowFailure: true });
    }

    for (const [kind, args] of [
      [
        "container",
        [
          "ps",
          "-aq",
          "--filter",
          `label=com.docker.compose.project=${PROJECT}`,
        ],
      ],
      [
        "network",
        [
          "network",
          "ls",
          "-q",
          "--filter",
          `label=com.docker.compose.project=${PROJECT}`,
        ],
      ],
      [
        "volume",
        [
          "volume",
          "ls",
          "-q",
          "--filter",
          `label=com.docker.compose.project=${PROJECT}`,
        ],
      ],
    ]) {
      const ids = docker(args, { allowFailure: true }).stdout
        .trim()
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
    await rm(envDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }

  console.log(
    `Drill assertions: ${passCount} passed, ${failCount} failed.`,
  );
}
