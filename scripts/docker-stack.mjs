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

const PUBLIC_ORIGIN_KEYS = [
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_MEDIA_BASE_URL",
  "MEDIA_PUBLIC_BASE_URL",
];

function publicOriginProblem(value) {
  if (!value) {
    return "unset";
  }

  let url;

  try {
    url = new URL(value);
  } catch {
    return "invalid URL";
  }

  if (url.protocol !== "https:") {
    return "not https";
  }

  const host = url.hostname.toLowerCase();

  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  ) {
    return "localhost";
  }

  return null;
}

function tunnelWarnings() {
  const values = readComposeEnvFile(ENV_PATH);
  const problems = PUBLIC_ORIGIN_KEYS.map((key) => [
    key,
    publicOriginProblem(values.get(key) ?? ""),
  ]).filter(([, problem]) => problem);
  const warnings = [];

  if (problems.length > 0) {
    warnings.push(
      `Tunnel profile active, but these public origins are not public HTTPS URLs: ${problems
        .map(([key, problem]) => `${key} (${problem})`)
        .join(", ")}.`,
    );
  } else {
    warnings.push(
      "Tunnel profile active. Public origins look like public HTTPS URLs.",
    );
  }

  warnings.push(
    "NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_MEDIA_BASE_URL and NEXT_PUBLIC_API_URL are baked into the web image at build time. Change them in .env.compose and rebuild the web image; restart the api after changing MEDIA_PUBLIC_BASE_URL or WEB_ORIGIN.",
  );

  if ((values.get("NODE_ENV") ?? "") !== "production") {
    warnings.push(
      "NODE_ENV is not production, so admin and customer cookies will not set the Secure flag. Use NODE_ENV=production for a real HTTPS tunnel deployment.",
    );
  }

  return warnings;
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

const ALL_PROFILES = ["--profile", "tunnel", "--profile", "quicktunnel"];

async function waitForQuickTunnelUrl(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = captureCompose([
      "logs",
      "--tail",
      "500",
      "quicktunnel",
    ]);

    if (result.status === 0) {
      const matches = result.stdout.match(
        /https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi,
      );

      if (matches && matches.length > 0) {
        return matches[matches.length - 1];
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(
    "Timed out waiting for the quick tunnel URL in the cloudflared logs.",
  );
}

async function up(profile) {
  requireEnvFile();

  if (profile) {
    if (
      profile === "tunnel" &&
      !(
        process.env.TUNNEL_TOKEN?.trim() ||
        (readComposeEnvFile(ENV_PATH).get("TUNNEL_TOKEN") ?? "").trim()
      )
    ) {
      throw new Error(
        "TUNNEL_TOKEN is missing or empty in .env.compose. The named tunnel profile needs the token from the Cloudflare dashboard; the token is never printed.",
      );
    }

    for (const warning of tunnelWarnings()) {
      console.warn(warning);
    }
  }

  compose(["build"]);
  compose(
    [...(profile ? ["--profile", profile] : []), "up", "-d", "--wait"],
    { timeout: 900_000 },
  );

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

  if (profile === "quicktunnel") {
    const quickUrl = await waitForQuickTunnelUrl();
    console.log(`Quick tunnel URL (testing only): ${quickUrl}`);
    console.warn(
      "Quick tunnel hostnames change on every start and are not baked into NEXT_PUBLIC_SITE_URL at build time. Admin login through this URL needs a web rebuild with this origin; use a named tunnel for a stable HTTPS deployment.",
    );
  } else if (profile === "tunnel") {
    console.log(
      "Named tunnel profile started. Use the public hostname configured in the Cloudflare dashboard.",
    );
  }
}

function down() {
  requireEnvFile();
  compose([...ALL_PROFILES, "down", "--remove-orphans"]);
}

function logs() {
  requireEnvFile();
  compose([...ALL_PROFILES, "logs", "-f", "--tail", "200"]);
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

  compose([...ALL_PROFILES, "down", "-v", "--remove-orphans"]);
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
  } else if (command === "up-tunnel") {
    await up("tunnel");
  } else if (command === "up-quick") {
    await up("quicktunnel");
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
      "Usage: node scripts/docker-stack.mjs <up|up-tunnel|up-quick|down|logs|reset --yes|smoke>",
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
