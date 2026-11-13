import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const SKIP_DIRS = new Set(["node_modules", ".next", "dist"]);
const SKIP_PATHS = ["apps/api/drizzle/meta"];
const SKIP_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".pdf",
  ".zip",
  ".mp4",
  ".webm",
  ".mov",
  ".mp3",
  ".wav",
  ".glb",
]);

const BAD_SEQUENCES = [
  { label: "U+00C2 double-encoded prefix", pattern: /\u00c2/g },
  {
    label: "U+00E2 U+20AC double-encoded punctuation",
    pattern: /\u00e2\u20ac/g,
  },
  { label: "U+00C3 double-encoded prefix", pattern: /\u00c3/g },
  { label: "U+FFFD replacement character", pattern: /\ufffd/g },
];

function normalize(file) {
  return file.split(path.sep).join("/");
}

function shouldSkip(file) {
  const normalized = normalize(file);

  if (SKIP_PATHS.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }

  const segments = normalized.split("/");

  if (segments.some((segment) => SKIP_DIRS.has(segment))) {
    return true;
  }

  return SKIP_EXTENSIONS.has(path.extname(normalized).toLowerCase());
}

function isBinary(buffer) {
  const sample = buffer.subarray(0, 8192);

  return sample.includes(0);
}

const output = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  maxBuffer: 64 * 1024 * 1024,
});
const files = output
  .toString("utf8")
  .split("\0")
  .filter(Boolean)
  .filter((file) => !shouldSkip(file));

const issues = [];
let checked = 0;

for (const file of files) {
  const absolute = path.join(root, file);
  const buffer = readFileSync(absolute);

  if (isBinary(buffer)) {
    continue;
  }

  checked += 1;

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    issues.push(`${file}:1:1 UTF-8 BOM found`);
  }

  let text;

  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    issues.push(`${file}:1:1 invalid UTF-8`);
    continue;
  }

  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    for (const { label, pattern } of BAD_SEQUENCES) {
      for (const match of line.matchAll(pattern)) {
        issues.push(
          `${file}:${index + 1}:${match.index + 1} ${label}`,
        );
      }
    }
  }
}

if (issues.length > 0) {
  console.error("Encoding check failed:");
  for (const issue of issues) {
    console.error(`  ${issue}`);
  }
  console.error(
    `\n${issues.length} issue(s) in git-tracked source files.`,
  );
  process.exit(1);
}

console.log(
  `Encoding check passed: ${checked} UTF-8 text files scanned.`,
);
