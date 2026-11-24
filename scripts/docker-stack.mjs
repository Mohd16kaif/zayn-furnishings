import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ENV_PATH } from "./compose-init-env.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const COMPOSE_FILE = "docker-compose.stack.yml";
const PROJECT = "zayn";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    timeout: options.timeout ?? 600_000,
    shell: false,
    env: {
      ...process.env,
      COMPOSE_ENV_FILE: options.envPath ?? ENV_PATH,
    },
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.slice(0, 2).join(" ")} failed with exit code ${result.status}`,
    );
  }

  return result;
}

function compose(args, options = {}) {
  return run(
    "docker",
    [
      "compose",
      "-p",
      PROJECT,
      "-f",
      COMPOSE_FILE,
      "--env-file",
      options.envPath ?? ENV_PATH,
      ...args,
    ],
    options,
  );
}

function captureCompose(args, options = {}) {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-p",
      PROJECT,
      "-f",
      COMPOSE_FILE,
      "--env-file",
      options.envPath ?? ENV_PATH,
      ...args,
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: "pipe",
      timeout: options.timeout ?? 60_000,
      shell: false,
      env: {
        ...process.env,
        COMPOSE_ENV_FILE: options.envPath ?? ENV_PATH,
      },
    },
  );

  if (result.error) {
    throw result.error;
  }

  return result;
}

function requireEnvFile() {
  if (!existsSync(ENV_PATH)) {
    throw new Error(
      ".env.compose is missing. Run `pnpm docker:stack:init` first.",
    );
  }
}

async function waitForEdge(url, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      });

      if (response.status < 500) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `Timed out waiting for the edge${lastError ? `: ${lastError.message}` : ""}`,
  );
}

async function up() {
  requireEnvFile();
  compose(["build"]);
  compose(["up", "-d", "--wait"], { timeout: 900_000 });

  const portResult = captureCompose(["port", "edge", "80"]);

  if (portResult.status !== 0) {
    throw new Error("Could not determine the published edge port.");
  }

  const address = portResult.stdout.trim().split(/\r?\n/)[0];
  const port = address.split(":").pop();

  if (!port) {
    throw new Error("The edge did not publish a host port.");
  }

  await waitForEdge(`http://127.0.0.1:${port}/`);
  console.log(`Stack is up at http://localhost:${port}`);
}

function down() {
  requireEnvFile();
  compose(["down", "--remove-orphans"]);
}

function logs() {
  requireEnvFile();
  compose(["logs", "-f", "--tail", "200"]);
}

function reset() {
  requireEnvFile();

  if (!process.argv.includes("--yes")) {
    console.error(
      "Refusing to remove volumes. Run `pnpm docker:stack:reset -- --yes` to confirm.",
    );
    process.exitCode = 1;
    return;
  }

  compose(["down", "-v", "--remove-orphans"]);
}

function smoke() {
  run(
    process.execPath,
    [path.join(REPO_ROOT, "scripts", "docker-stack-smoke.mjs")],
    { timeout: 1_800_000 },
  );
}

const command = process.argv[2];

try {
  if (command === "up") {
    await up();
  } else if (command === "down") {
    down();
  } else if (command === "logs") {
    logs();
  } else if (command === "reset") {
    reset();
  } else if (command === "smoke") {
    smoke();
  } else {
    console.error(
      "Usage: node scripts/docker-stack.mjs <up|down|logs|reset --yes|smoke>",
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
