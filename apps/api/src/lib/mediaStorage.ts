import { randomUUID } from "node:crypto";
import {
  mkdir,
  realpath,
  rename,
  stat,
  statfs,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { getSupabaseAdmin } from "./supabase";

export const PRODUCT_IMAGES_BUCKET = "product-images";
export const MEDIA_PATH_PATTERN =
  /^(products|content|categories)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/i;

export type MediaDriverName = "supabase" | "local";

export interface MediaStorage {
  readonly driver: MediaDriverName;
  put(path: string, buffer: Buffer, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  publicUrl(path: string): string;
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
  readonly driver = "local" as const;

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

  publicUrl(relativePath: string): string {
    const checkedPath = validateMediaPath(relativePath);

    return `${this.publicBaseUrl}/media/${checkedPath}`;
  }
}

export class SupabaseMediaStorage implements MediaStorage {
  readonly driver = "supabase" as const;

  private storage() {
    return getSupabaseAdmin().storage.from(PRODUCT_IMAGES_BUCKET);
  }

  async put(
    relativePath: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    const { error } = await this.storage().upload(relativePath, buffer, {
      contentType,
      cacheControl: "31536000",
      upsert: false,
    });

    if (error) {
      throw new MediaStorageError(error.message);
    }
  }

  async remove(paths: string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }

    const { error } = await this.storage().remove(paths);

    if (error) {
      throw new MediaStorageError(error.message);
    }
  }

  publicUrl(relativePath: string): string {
    return this.storage().getPublicUrl(relativePath).data.publicUrl;
  }
}

export type MediaStorageConfig = {
  driver: MediaDriverName;
  mediaDir?: string;
  publicBaseUrl?: string;
  minFreeMb?: number;
  getFreeBytes?: (mediaDir: string) => Promise<number>;
};

export function createMediaStorage(
  config: MediaStorageConfig,
): MediaStorage {
  if (config.driver === "supabase") {
    return new SupabaseMediaStorage();
  }

  if (!config.mediaDir) {
    throw new MediaStorageError(
      "MEDIA_DIR is required for the local media driver.",
    );
  }

  if (!config.publicBaseUrl) {
    throw new MediaStorageError(
      "MEDIA_PUBLIC_BASE_URL is required for the local media driver.",
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
      driver: env.MEDIA_DRIVER,
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
