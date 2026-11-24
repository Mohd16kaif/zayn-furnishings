import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);
export const EXAMPLE_PATH = path.join(REPO_ROOT, ".env.compose.example");
export const ENV_PATH = path.join(REPO_ROOT, ".env.compose");

const ALPHANUMERIC =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Alphanumeric output is deliberate: POSTGRES_PASSWORD is embedded directly
 * in DATABASE_URL, so URL-special characters would need escaping.
 */
export function randomAlphanumeric(length) {
  let value = "";

  for (let index = 0; index < length; index += 1) {
    value += ALPHANUMERIC[randomInt(0, ALPHANUMERIC.length)];
  }

  return value;
}

export function createComposeEnvValues(overrides = {}) {
  return {
    POSTGRES_USER: "zayn",
    POSTGRES_PASSWORD: randomAlphanumeric(32),
    POSTGRES_DB: "zayn",
    NODE_ENV: "development",
    APP_ENV: "development",
    EDGE_HOST_PORT: "8080",
    NEXT_PUBLIC_API_URL: "http://localhost:8080",
    NEXT_PUBLIC_MEDIA_BASE_URL: "http://localhost:8080",
    NEXT_PUBLIC_SITE_URL: "http://localhost:8080",
    NEXT_PUBLIC_APP_ENV: "development",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "",
    MEDIA_PUBLIC_BASE_URL: "http://localhost:8080",
    MEDIA_MIN_FREE_MB: "500",
    WEB_ORIGIN: "http://localhost:8080",
    ADMIN_AUTH_SECRET: randomAlphanumeric(48),
    STOREFRONT_API_KEY: randomAlphanumeric(48),
    OWNER_EMAIL: "",
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    RESEND_API_KEY: "",
    EMAIL_FROM: "",
    TWILIO_ACCOUNT_SID: "",
    TWILIO_AUTH_TOKEN: "",
    TWILIO_VERIFY_SERVICE_SID: "",
    APPLE_PAY_DOMAIN_ASSOCIATION: "",
    ...overrides,
  };
}

export function renderComposeEnvFromExample(exampleText, values) {
  const seen = new Set();
  const lines = exampleText.split(/\r?\n/).map((line) => {
    const match = /^([A-Z0-9_]+)=/.exec(line);

    if (!match) {
      return line;
    }

    const key = match[1];
    seen.add(key);

    return `${key}=${values[key] ?? ""}`;
  });

  const missing = Object.keys(values)
    .filter((key) => !seen.has(key))
    .sort();

  if (missing.length > 0) {
    lines.push("", "# Additional generated variables");
    for (const key of missing) {
      lines.push(`${key}=${values[key] ?? ""}`);
    }
  }

  return `${lines.join("\n").replace(/\n*$/, "")}\n`;
}

export async function writeComposeEnvFile(filePath, values, options = {}) {
  if (!options.overwrite && existsSync(filePath)) {
    throw new Error(
      `${filePath} already exists. Remove it manually before generating a new one.`,
    );
  }

  const example = await readFile(EXAMPLE_PATH, "utf8");
  const content = renderComposeEnvFromExample(example, values);

  await writeFile(filePath, content, {
    encoding: "utf8",
    mode: 0o600,
    flag: options.overwrite ? "w" : "wx",
  });
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    if (existsSync(ENV_PATH)) {
      console.error(
        ".env.compose already exists. Refusing to overwrite it; remove it manually first.",
      );
      process.exitCode = 1;
    } else {
      await writeComposeEnvFile(ENV_PATH, createComposeEnvValues());
      console.log(
        "Created .env.compose from .env.compose.example. Generated secrets were not printed.",
      );
      console.log(
        "Set OWNER_EMAIL (and any Stripe/Resend/Twilio values you need), then run pnpm docker:stack:up.",
      );
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  }
}
