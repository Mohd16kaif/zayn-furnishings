import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const PUBLIC_BUILD_DEFAULTS = {
  NEXT_PUBLIC_API_URL: "http://localhost:4000",
  NEXT_PUBLIC_MEDIA_BASE_URL: "http://localhost:4000",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "",
  NEXT_PUBLIC_APP_ENV: "development",
  API_INTERNAL_URL: "http://api:4000",
};

function runDocker(args) {
  const result = spawnSync("docker", args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`docker ${args[0]} failed with exit code ${result.status}`);
  }
}

export function buildApiImage({
  tag = "zayn-api:local",
  extraArgs = [],
} = {}) {
  runDocker([
    "build",
    "-f",
    "apps/api/Dockerfile",
    "-t",
    tag,
    ...extraArgs,
    ".",
  ]);

  return tag;
}

export function buildWebImage({
  tag = "zayn-web:local",
  publicEnv = {},
  extraArgs = [],
} = {}) {
  const values = {
    ...PUBLIC_BUILD_DEFAULTS,
    ...Object.fromEntries(
      Object.entries(publicEnv).filter(([, value]) => value !== undefined),
    ),
  };

  const buildArgs = Object.entries(values).flatMap(([key, value]) => [
    "--build-arg",
    `${key}=${value}`,
  ]);

  runDocker([
    "build",
    "-f",
    "apps/web/Dockerfile",
    "-t",
    tag,
    ...buildArgs,
    ...extraArgs,
    ".",
  ]);

  return tag;
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const command = process.argv[2];

  try {
    if (command === "api") {
      buildApiImage();
    } else if (command === "web") {
      buildWebImage();
    } else {
      console.error("Usage: node scripts/docker-build.mjs <api|web>");
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  }
}
