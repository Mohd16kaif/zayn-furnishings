import { readFileSync } from "node:fs";

/**
 * Reads only simple KEY=value pairs from a dotenv-style file. Values are never
 * logged by callers that use this helper.
 */
export function parseComposeEnv(text) {
  const values = new Map();

  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) {
      continue;
    }

    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);

    if (!match) {
      continue;
    }

    let value = match[2];

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values.set(match[1], value);
  }

  return values;
}

export function readComposeEnvFile(filePath) {
  try {
    return parseComposeEnv(readFileSync(filePath, "utf8"));
  } catch {
    return new Map();
  }
}

export function hasComposeEnvKey(text, key) {
  return new RegExp(`^\\s*${key}\\s*=`, "m").test(text);
}
