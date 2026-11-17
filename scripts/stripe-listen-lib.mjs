import { readFile, writeFile } from "node:fs/promises";

const WEBHOOK_SECRET_PATTERN = /whsec_[A-Za-z0-9]+/g;
const API_KEY_PATTERN = /\b(?:sk|rk)_[A-Za-z0-9_]+\b/g;

export function parseEnv(content) {
  const values = {};
  const text = content.replace(/^\uFEFF/, "");

  for (const rawLine of text.split(/\r\n|\n|\r/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const match =
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);

    if (!match) {
      continue;
    }

    const key = match[1];
    let value = match[2].trim();
    const quote = value[0];

    if (
      (quote === '"' || quote === "'") &&
      value.length >= 2 &&
      value.endsWith(quote)
    ) {
      value = value.slice(1, -1);

      if (quote === '"') {
        value = value
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
      }
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }

    values[key] = value;
  }

  return values;
}

export function redactSecrets(text) {
  return String(text)
    .replace(WEBHOOK_SECRET_PATTERN, (secret) => {
      return `whsec_...${secret.slice(-4)}`;
    })
    .replace(API_KEY_PATTERN, (key) => {
      const prefix = key.startsWith("rk_") ? "rk_" : "sk_";

      return `${prefix}...${key.slice(-4)}`;
    });
}

export function extractWebhookSecrets(text) {
  const matches = String(text).match(WEBHOOK_SECRET_PATTERN) ?? [];

  return Array.from(new Set(matches));
}

export function maskSecretEnd(secret) {
  const value = String(secret ?? "").trim();

  return value ? value.slice(-4) : "missing";
}

export function secretsMatch(expected, actual) {
  const left = String(expected ?? "").trim();
  const right = String(actual ?? "").trim();

  return Boolean(left) && Boolean(right) && left === right;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstLineEnding(content) {
  const match = /\r\n|\n|\r/.exec(content);

  return match ? match[0] : "\n";
}

export function replaceEnvValue(content, key, value) {
  const source = content.replace(/^\uFEFF/, "");
  const lineEnding = firstLineEnding(source);
  const pattern = new RegExp(
    `^([ \\t]*(?:export[ \\t]+)?${escapeRegExp(key)}[ \\t]*=[ \\t]*)[^\\r\\n]*`,
    "gm",
  );
  let replaced = false;
  const next = source.replace(pattern, (_match, prefix) => {
    replaced = true;

    return `${prefix}${value}`;
  });

  if (replaced) {
    return next;
  }

  if (!source) {
    return `${key}=${value}`;
  }

  if (/(?:\r\n|\n|\r)$/.test(source)) {
    return `${source}${key}=${value}${lineEnding}`;
  }

  return `${source}${lineEnding}${key}=${value}`;
}

export async function updateEnvFileValue(filePath, key, value) {
  const content = await readFile(filePath, "utf8");
  const next = replaceEnvValue(content, key, value);

  await writeFile(filePath, next, "utf8");

  return next;
}
