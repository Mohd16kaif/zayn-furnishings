import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ENV_PATH } from "./compose-init-env.mjs";
import { readComposeEnvFile } from "./compose-env.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const COMPOSE_FILE = "docker-compose.stack.yml";
const PROJECT = "zayn";
const SERVICE = "backup";
const REQUIRED_RUNNING_SERVICES = ["postgres", "api", "web", "edge"];

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
    timeout: options.timeout ?? 120_000,
    shell: false,
  });

  if (result.error) {
    throw result.error;
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
      ENV_PATH,
      ...args,
    ],
    options,
  );
}

function envValue(values, key) {
  return (process.env[key] ?? values.get(key) ?? "").trim();
}

function requireEnvFile() {
  if (!existsSync(ENV_PATH)) {
    throw new Error(
      ".env.compose is missing. Run `pnpm docker:stack:init` first.",
    );
  }
}

function requireBackupEnv(values) {
  if (!envValue(values, "RESTIC_PASSWORD")) {
    throw new Error(
      "RESTIC_PASSWORD is missing in .env.compose. Add a long random value; it is never printed. Losing it makes every backup unreadable.",
    );
  }

  if (!envValue(values, "RESTIC_REPOSITORY")) {
    throw new Error(
      "RESTIC_REPOSITORY is missing in .env.compose. Use /repo for local development, or an S3-compatible or sftp repository for real off-server backups.",
    );
  }
}

function ensureBackupImage() {
  const inspected = docker(["image", "inspect", "zayn-backup:stack"]);

  if (inspected.status !== 0) {
    console.log("Building the backup image...");
    const built = compose(["--profile", "backup", "build", "backup"], {
      inherit: true,
      timeout: 30 * 60 * 1000,
    });

    if (built.status !== 0) {
      throw new Error("Could not build the backup image.");
    }
  }
}

function requireStackUp() {
  for (const service of REQUIRED_RUNNING_SERVICES) {
    const id = compose(["ps", "-q", service], {
      allowFailure: true,
    }).stdout.trim().split(/\r?\n/)[0];

    if (!id) {
      throw new Error(
        `The zayn stack is not up: ${service} has no running container. Run \`pnpm docker:stack:up\` first.`,
      );
    }

    const running = docker([
      "inspect",
      "--format",
      "{{.State.Running}}",
      id,
    ]).stdout.trim();

    if (running !== "true") {
      throw new Error(
        `The zayn stack is not up: ${service} is not running. Run \`pnpm docker:stack:up\` first.`,
      );
    }
  }
}

function runBackupCommand(command, args = []) {
  const result = compose(
    [
      "--profile",
      "backup",
      "run",
      "--rm",
      "--no-deps",
      SERVICE,
      command,
      ...args,
    ],
    { inherit: true, timeout: 6 * 60 * 60 * 1000 },
  );

  return result.status ?? 1;
}

const command = process.argv[2];

try {
  if (command === "run") {
    requireEnvFile();
    const values = readComposeEnvFile(ENV_PATH);
    requireBackupEnv(values);
    requireStackUp();
    ensureBackupImage();
    const status = runBackupCommand("backup");

    if (status !== 0) {
      process.exitCode = status || 1;
    } else {
      console.log("Backup finished.");
    }
  } else if (command === "list") {
    requireEnvFile();
    const values = readComposeEnvFile(ENV_PATH);
    requireBackupEnv(values);
    ensureBackupImage();
    const status = runBackupCommand("list");

    if (status !== 0) {
      process.exitCode = status || 1;
    }
  } else {
    console.error("Usage: node scripts/docker-backup.mjs <run|list>");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
