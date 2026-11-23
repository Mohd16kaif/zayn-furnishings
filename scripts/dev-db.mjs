import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";

const COMPOSE_ARGS = ["compose", "-f", "docker-compose.dev.yml"];
const DEV_DATABASE_URL =
  "postgres://zayn_dev:zayn_dev_local@127.0.0.1:5433/zayn_dev";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function capture(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function compose(args) {
  run("docker", [...COMPOSE_ARGS, ...args]);
}

function runPnpm(args, options = {}) {
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec || "cmd.exe";
    run(
      comspec,
      ["/d", "/s", "/c", ["pnpm", ...args].join(" ")],
      options,
    );
    return;
  }

  run("pnpm", args, options);
}

async function waitForHealthy() {
  const containerId = capture("docker", [
    ...COMPOSE_ARGS,
    "ps",
    "-q",
    "postgres",
  ]);

  if (!containerId) {
    throw new Error(
      "The local Postgres container was not found after docker compose up.",
    );
  }

  for (let attempt = 1; attempt <= 90; attempt += 1) {
    let status = "";

    try {
      status = capture("docker", [
        "inspect",
        "--format",
        "{{.State.Health.Status}}",
        containerId,
      ]);
    } catch {
      status = "";
    }

    if (status === "healthy") {
      console.log("Local Postgres is healthy.");
      return;
    }

    if (status === "unhealthy") {
      throw new Error("The local Postgres container is unhealthy.");
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error("Timed out waiting for the local Postgres container.");
}

async function up() {
  compose(["up", "-d"]);
  await waitForHealthy();
  console.log(`Local Postgres ready: ${DEV_DATABASE_URL}`);
}

function down() {
  compose(["down"]);
  console.log("Local Postgres stopped. The data volume was kept.");
}

async function reset() {
  compose(["down", "-v"]);
  await up();

  const env = {
    ...process.env,
    DATABASE_URL: DEV_DATABASE_URL,
    DATABASE_SSL: "disable",
    NODE_ENV: "development",
  };

  runPnpm(["--filter", "@zayn/api", "db:migrate"], { env });
  runPnpm(["--filter", "@zayn/api", "db:seed-categories"], { env });
  console.log("Local Postgres reset, migrated, and category-seeded.");
}

const command = process.argv[2];

try {
  if (command === "up") {
    await up();
  } else if (command === "down") {
    down();
  } else if (command === "reset") {
    await reset();
  } else {
    console.error("Usage: node scripts/dev-db.mjs <up|down|reset>");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
