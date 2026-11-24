import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { connection, db } from "../db/client";
import {
  categories,
  contentBlocks,
  productImages,
} from "../db/schema";
import {
  getMediaStorage,
  isMediaOwnerDirectory,
  resolveExistingMediaFile,
  validateMediaPath,
} from "../lib/mediaStorage";

type ReferencedRow = {
  table: string;
  id: string;
  path: string;
};

async function listMediaFiles(
  mediaDir: string,
): Promise<{ files: string[]; ignored: string[] }> {
  const files: string[] = [];
  const ignored: string[] = [];

  async function visit(directory: string, prefix: string): Promise<void> {
    let entries;

    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const relativePath = prefix
        ? `${prefix}/${entry.name}`
        : entry.name;

      if (entry.isSymbolicLink()) {
        ignored.push(`${relativePath} (symlink)`);
        continue;
      }

      if (entry.isDirectory()) {
        await visit(
          path.join(directory, entry.name),
          relativePath,
        );
        continue;
      }

      if (!entry.isFile()) {
        ignored.push(`${relativePath} (not a file)`);
        continue;
      }

      try {
        files.push(validateMediaPath(relativePath));
      } catch {
        ignored.push(relativePath);
      }
    }
  }

  await visit(mediaDir, "");

  return { files, ignored };
}

async function listEmptyOwnerDirectories(
  mediaDir: string,
): Promise<string[]> {
  const empty: string[] = [];

  let topEntries: Dirent[];

  try {
    topEntries = await readdir(mediaDir, { withFileTypes: true });
  } catch {
    return empty;
  }

  for (const top of topEntries) {
    if (!top.isDirectory() || top.isSymbolicLink()) {
      continue;
    }

    let ownerEntries: Dirent[];

    try {
      ownerEntries = await readdir(
        path.join(mediaDir, top.name),
        { withFileTypes: true },
      );
    } catch {
      continue;
    }

    for (const owner of ownerEntries) {
      if (!owner.isDirectory() || owner.isSymbolicLink()) {
        continue;
      }

      const relativePath = `${top.name}/${owner.name}`;

      if (!isMediaOwnerDirectory(relativePath)) {
        continue;
      }

      try {
        const contents = await readdir(
          path.join(mediaDir, top.name, owner.name),
        );

        if (contents.length === 0) {
          empty.push(relativePath);
        }
      } catch {
        continue;
      }
    }
  }

  return empty.sort();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const deleteMode = args.includes("--delete");
  const dryRun = args.includes("--dry-run");

  if (deleteMode && dryRun) {
    console.error("Use either --delete or --dry-run, not both.");
    process.exitCode = 1;
    return;
  }

  if (!db) {
    console.error("DATABASE_URL is required.");
    process.exitCode = 1;
    return;
  }

  const mediaDir = env.MEDIA_DIR;
  const storage = getMediaStorage();

  const [productRows, contentRows, categoryRows] = await Promise.all([
    db
      .select({ id: productImages.id, path: productImages.storagePath })
      .from(productImages),
    db
      .select({ id: contentBlocks.id, path: contentBlocks.storagePath })
      .from(contentBlocks),
    db
      .select({ id: categories.id, path: categories.imageStoragePath })
      .from(categories),
  ]);

  const referenced: ReferencedRow[] = [
    ...productRows
      .filter((row) => Boolean(row.path))
      .map((row) => ({
        table: "product_images",
        id: row.id,
        path: row.path!,
      })),
    ...contentRows
      .filter((row) => Boolean(row.path))
      .map((row) => ({
        table: "content_blocks",
        id: row.id,
        path: row.path!,
      })),
    ...categoryRows
      .filter((row) => Boolean(row.path))
      .map((row) => ({
        table: "categories",
        id: row.id,
        path: row.path!,
      })),
  ];

  const referencedPaths = new Set(referenced.map((row) => row.path));
  const { files, ignored } = await listMediaFiles(mediaDir);
  const emptyFolders = await listEmptyOwnerDirectories(mediaDir);
  const fileSet = new Set(files);
  const orphans = files.filter((file) => !referencedPaths.has(file));
  const missing: ReferencedRow[] = [];

  for (const row of referenced) {
    const resolved = await resolveExistingMediaFile(
      mediaDir,
      row.path,
    ).catch(() => null);

    if (!resolved) {
      missing.push(row);
    }
  }

  console.log(`Media dir: ${mediaDir}`);
  console.log(`Mode: ${deleteMode ? "delete" : "report only"}`);
  console.log(`Referenced paths: ${referenced.length}`);
  console.log(`Files on disk: ${fileSet.size}`);
  console.log(`Orphan files: ${orphans.length}`);

  for (const orphan of orphans) {
    console.log(`  orphan ${orphan}`);
  }

  console.log(`Empty media folders: ${emptyFolders.length}`);

  for (const emptyFolder of emptyFolders) {
    console.log(`  empty ${emptyFolder}`);
  }

  console.log(`Missing referenced files: ${missing.length}`);

  for (const row of missing) {
    console.log(`  missing ${row.table} ${row.id} ${row.path}`);
  }

  if (ignored.length > 0) {
    console.log(`Ignored files: ${ignored.length}`);

    for (const entry of ignored) {
      console.log(`  ignored ${entry}`);
    }
  }

  if (deleteMode && orphans.length > 0) {
    await storage.remove(orphans);
    console.log(`Deleted orphan files: ${orphans.length}`);
  }

  if (deleteMode && emptyFolders.length > 0) {
    await storage.removeEmptyDirectories(emptyFolders);
    console.log(`Deleted empty media folders: ${emptyFolders.length}`);
  }
}

main()
  .catch((error) => {
    console.error(
      "Media orphan check failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection?.end();
  });
