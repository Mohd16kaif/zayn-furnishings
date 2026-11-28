import { createRequire } from "node:module";
import {
  mkdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const APP_DIR = path.join(REPO_ROOT, "apps", "web", "src", "app");
const requireApi = createRequire(
  path.join(REPO_ROOT, "apps", "api", "package.json"),
);
const sharp = requireApi("sharp");

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#2A1D14"/>
  <path fill="#B8893B" d="M13 11h38v9L28 44h23v9H13v-9l23-24H13z"/>
  <path fill="#D4AF6A" d="M13 11h38v5H13z"/>
</svg>
`;

function icoBuffer(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = Buffer.alloc(images.length * 16);
  let offset = 6 + entries.length;

  images.forEach((image, index) => {
    const entry = index * 16;
    entries.writeUInt8(image.size >= 256 ? 0 : image.size, entry);
    entries.writeUInt8(image.size >= 256 ? 0 : image.size, entry + 1);
    entries.writeUInt8(0, entry + 2);
    entries.writeUInt8(0, entry + 3);
    entries.writeUInt16LE(1, entry + 4);
    entries.writeUInt16LE(32, entry + 6);
    entries.writeUInt32LE(image.data.length, entry + 8);
    entries.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  });

  return Buffer.concat([
    header,
    entries,
    ...images.map((image) => image.data),
  ]);
}

async function png(size) {
  return sharp(Buffer.from(SVG))
    .resize(size, size)
    .png()
    .toBuffer();
}

async function main() {
  mkdirSync(APP_DIR, { recursive: true });

  writeFileSync(path.join(APP_DIR, "icon.svg"), SVG, "utf8");

  const icon512 = await png(512);
  const apple180 = await png(180);
  const favicon = icoBuffer(
    await Promise.all(
      [16, 32, 48].map(async (size) => ({
        size,
        data: await png(size),
      })),
    ),
  );

  writeFileSync(path.join(APP_DIR, "icon.png"), icon512);
  writeFileSync(path.join(APP_DIR, "apple-icon.png"), apple180);
  writeFileSync(path.join(APP_DIR, "favicon.ico"), favicon);

  console.log("Generated icon.svg, icon.png, apple-icon.png and favicon.ico.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
