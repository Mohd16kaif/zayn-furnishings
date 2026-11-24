import { randomUUID } from "node:crypto";
import {
  mkdir,
  realpath,
  rename,
  rmdir,
  stat,
  statfs,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";

export const MEDIA_FOLDERS = ["products", "content", "categories"] as const;

const OWNER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MEDIA_PATH_PATTERN =
  /^(products|content|categories)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/i;

export interface MediaStorage {
  put(path: string, buffer: Buffer, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  removeEmptyDirectories(relativeDirectories: string[]): Promise<void>;
  publicUrl(path: string): string;
}

/**
 * True only for a valid owner directory exactly one level under one of the
 * three media folders, for example `products/<uuid>`. MEDIA_DIR itself and
 * the three top-level folders never match.
 */
export function isMediaOwnerDirectory(relativePath: string): boolean {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    relativePath.includes("%") ||
    relativePath.includes("//")
  ) {
    return false;
  }

  const parts = relativePath.split("/");

  if (parts.length !== 2) {
    return false;
  }

  return (
    (MEDIA_FOLDERS as readonly string[]).includes(parts[0]) &&
    OWNER_ID_PATTERN.test(parts[1])
  );
}

export class MediaStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaStorageError";
  }
}

export class MediaStorageCapacityError extends MediaStorageError {
  constructor(
    message = "The media server is low on disk space. Please try again later.",
  ) {
    super(message);
    this.name = "MediaStorageCapacityError";
  }
}

export function validateMediaPath(relativePath: string): string {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new MediaStorageError("Invalid media path.");
  }

  if (
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    relativePath.includes("%") ||
    relativePath.includes("//")
  ) {
    throw new MediaStorageError("Invalid media path.");
  }

  if (
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath)
  ) {
    throw new MediaStorageError("Invalid media path.");
  }

  if (!MEDIA_PATH_PATTERN.test(relativePath)) {
    throw new MediaStorageError("Invalid media path.");
  }

  return relativePath;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);

  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function resolveRoot(mediaDir: string): Promise<string | null> {
  try {
    return await realpath(mediaDir);
  } catch {
    return null;
  }
}

export async function resolveExistingMediaFile(
  mediaDir: string,
  relativePath: string,
): Promise<string | null> {
  const checkedPath = validateMediaPath(relativePath);
  const root = await resolveRoot(mediaDir);

  if (!root) {
    return null;
  }

  const target = path.join(root, ...checkedPath.split("/"));

  let parent: string;

  try {
    parent = await realpath(path.dirname(target));
  } catch {
    return null;
  }

  if (!isInside(root, parent)) {
    return null;
  }

  let resolved: string;

  try {
    resolved = await realpath(target);
  } catch {
    return null;
  }

  if (!isInside(root, resolved)) {
    return null;
  }

  const info = await stat(resolved);

  return info.isFile() ? resolved : null;
}

async function defaultFreeBytes(mediaDir: string): Promise<number> {
  const stats = await statfs(mediaDir);

  return Number(stats.bavail) * Number(stats.bsize);
}

export type LocalMediaStorageOptions = {
  mediaDir: string;
  publicBaseUrl: string;
  minFreeMb?: number;
  getFreeBytes?: (mediaDir: string) => Promise<number>;
};

export class LocalMediaStorage implements MediaStorage {
  private readonly mediaDir: string;
  private readonly publicBaseUrl: string;
  private readonly minFreeBytes: number;
  private readonly getFreeBytes: (mediaDir: string) => Promise<number>;
  private warnedFreeSpace = false;

  constructor(options: LocalMediaStorageOptions) {
    if (!path.isAbsolute(options.mediaDir)) {
      throw new MediaStorageError("MEDIA_DIR must be an absolute path.");
    }

    this.mediaDir = path.resolve(options.mediaDir);
    this.publicBaseUrl = options.publicBaseUrl.replace(/\/+$/, "");
    this.minFreeBytes =
      Math.max(0, options.minFreeMb ?? 500) * 1024 * 1024;
    this.getFreeBytes = options.getFreeBytes ?? defaultFreeBytes;
  }

  get directory(): string {
    return this.mediaDir;
  }

  private async ensureRoot(): Promise<string> {
    await mkdir(this.mediaDir, {
      recursive: true,
      mode: 0o750,
    });

    const root = await resolveRoot(this.mediaDir);

    if (!root) {
      throw new MediaStorageError("The media directory is unavailable.");
    }

    return root;
  }

  private async ensureFreeSpace(root: string): Promise<void> {
    let freeBytes: number;

    try {
      freeBytes = await this.getFreeBytes(root);
    } catch {
      if (!this.warnedFreeSpace) {
        console.warn(
          `Could not determine free disk space for ${root}; local media uploads are allowed.`,
        );
        this.warnedFreeSpace = true;
      }

      return;
    }

    if (freeBytes < this.minFreeBytes) {
      throw new MediaStorageCapacityError(
        "The media server is low on disk space. Please try again later or free space on the media volume.",
      );
    }
  }

  async put(
    relativePath: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    const checkedPath = validateMediaPath(relativePath);

    if (contentType !== "image/webp") {
      throw new MediaStorageError("Unsupported media content type.");
    }

    const root = await this.ensureRoot();
    await this.ensureFreeSpace(root);

    const target = path.join(root, ...checkedPath.split("/"));
    const parent = path.dirname(target);

    await mkdir(parent, {
      recursive: true,
      mode: 0o750,
    });

    const parentReal = await realpath(parent);

    if (!isInside(root, parentReal)) {
      throw new MediaStorageError("Invalid media path.");
    }

    const targetReal = path.join(parentReal, path.basename(target));
    const tempPath = path.join(
      parentReal,
      `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`,
    );

    try {
      await writeFile(tempPath, buffer, {
        flag: "wx",
        mode: 0o600,
      });
      await rename(tempPath, targetReal);
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);

      if (error instanceof MediaStorageError) {
        throw error;
      }

      throw new MediaStorageError("The media file could not be saved.");
    }
  }

  private async removeEmptyParent(filePath: string): Promise<void> {
    const root = await resolveRoot(this.mediaDir);

    if (!root) {
      return;
    }

    const parent = path.dirname(filePath);

    if (!isInside(root, parent)) {
      return;
    }

    const relativeParent = path
      .relative(root, parent)
      .split(path.sep)
      .join("/");

    if (!isMediaOwnerDirectory(relativeParent)) {
      return;
    }

    try {
      await rmdir(parent);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code !== undefined &&
        ["ENOENT", "ENOTEMPTY", "EEXIST"].includes(
          (error as { code: string }).code,
        )
      ) {
        return;
      }

      throw error;
    }
  }

  async remove(paths: string[]): Promise<void> {
    const errors: string[] = [];

    for (const relativePath of paths) {
      try {
        const resolved = await resolveExistingMediaFile(
          this.mediaDir,
          relativePath,
        );

        if (!resolved) {
          continue;
        }

        await unlink(resolved);
        await this.removeEmptyParent(resolved);
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: string }).code === "ENOENT"
        ) {
          continue;
        }

        errors.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    if (errors.length > 0) {
      throw new MediaStorageError(
        `Failed to delete media files: ${errors.join("; ")}`,
      );
    }
  }

  async removeEmptyDirectories(
    relativeDirectories: string[],
  ): Promise<void> {
    const root = await resolveRoot(this.mediaDir);

    if (!root) {
      return;
    }

    const errors: string[] = [];

    for (const relativeDirectory of relativeDirectories) {
      if (!isMediaOwnerDirectory(relativeDirectory)) {
        continue;
      }

      const candidate = path.join(
        root,
        ...relativeDirectory.split("/"),
      );

      let resolved: string;

      try {
        resolved = await realpath(candidate);
      } catch {
        continue;
      }

      if (!isInside(root, resolved)) {
        continue;
      }

      const relativeToRoot = path
        .relative(root, resolved)
        .split(path.sep)
        .join("/");

      if (!isMediaOwnerDirectory(relativeToRoot)) {
        continue;
      }

      try {
        await rmdir(resolved);
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          ["ENOENT", "ENOTEMPTY", "EEXIST"].includes(
            (error as { code?: string }).code ?? "",
          )
        ) {
          continue;
        }

        errors.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    if (errors.length > 0) {
      throw new MediaStorageError(
        `Failed to delete empty media folders: ${errors.join("; ")}`,
      );
    }
  }

  publicUrl(relativePath: string): string {
    const checkedPath = validateMediaPath(relativePath);

    return `${this.publicBaseUrl}/media/${checkedPath}`;
  }
}

export type MediaStorageConfig = {
  mediaDir?: string;
  publicBaseUrl?: string;
  minFreeMb?: number;
  getFreeBytes?: (mediaDir: string) => Promise<number>;
};

export function createMediaStorage(
  config: MediaStorageConfig,
): MediaStorage {
  if (!config.mediaDir) {
    throw new MediaStorageError(
      "MEDIA_DIR is required for media storage.",
    );
  }

  if (!config.publicBaseUrl) {
    throw new MediaStorageError(
      "MEDIA_PUBLIC_BASE_URL is required for media storage.",
    );
  }

  return new LocalMediaStorage({
    mediaDir: config.mediaDir,
    publicBaseUrl: config.publicBaseUrl,
    minFreeMb: config.minFreeMb,
    getFreeBytes: config.getFreeBytes,
  });
}

let cachedMediaStorage: MediaStorage | null = null;

export function getMediaStorage(): MediaStorage {
  if (!cachedMediaStorage) {
    cachedMediaStorage = createMediaStorage({
      mediaDir: env.MEDIA_DIR,
      publicBaseUrl: env.MEDIA_PUBLIC_BASE_URL,
      minFreeMb: env.MEDIA_MIN_FREE_MB,
    });
  }

  return cachedMediaStorage;
}

export function resetMediaStorageForTests(): void {
  cachedMediaStorage = null;
}
