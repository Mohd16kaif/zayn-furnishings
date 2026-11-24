import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LocalMediaStorage,
  MediaStorageCapacityError,
  MediaStorageError,
  createMediaStorage,
  resolveExistingMediaFile,
  validateMediaPath,
} from "../src/lib/mediaStorage";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const IMAGE_ID = "22222222-2222-4222-8222-222222222222";
const IMAGE_ID_2 = "33333333-3333-4333-8333-333333333333";
const RELATIVE_PATH = `products/${OWNER_ID}/${IMAGE_ID}.webp`;
const PUBLIC_BASE = "https://api.example.com/";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "zayn-media-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function localStorage(
  overrides: Partial<ConstructorParameters<typeof LocalMediaStorage>[0]> = {},
): LocalMediaStorage {
  return new LocalMediaStorage({
    mediaDir: tempDir,
    publicBaseUrl: PUBLIC_BASE,
    minFreeMb: 1,
    getFreeBytes: async () => 10 * 1024 * 1024 * 1024,
    ...overrides,
  });
}

describe("media path allow-list", () => {
  it("accepts the existing three folders and UUID WebP names", () => {
    for (const folder of ["products", "content", "categories"]) {
      expect(
        validateMediaPath(`${folder}/${OWNER_ID}/${IMAGE_ID}.webp`),
      ).toBe(`${folder}/${OWNER_ID}/${IMAGE_ID}.webp`);
    }
  });

  it("rejects traversal, absolute paths, backslashes, NUL, encoded dots, wrong folders and extensions", () => {
    const invalid = [
      "",
      "../outside.webp",
      `products/${OWNER_ID}/../${IMAGE_ID}.webp`,
      `products/${OWNER_ID}/..%2f${IMAGE_ID}.webp`,
      `products/${OWNER_ID}/%2e%2e/${IMAGE_ID}.webp`,
      "/etc/passwd",
      "C:\\media\\products\\x.webp",
      `products\\${OWNER_ID}\\${IMAGE_ID}.webp`,
      `products/${OWNER_ID}/${IMAGE_ID}.webp\0`,
      `other/${OWNER_ID}/${IMAGE_ID}.webp`,
      `products/${OWNER_ID}/${IMAGE_ID}.png`,
      `products/${OWNER_ID}/not-a-uuid.webp`,
      `products/not-a-uuid/${IMAGE_ID}.webp`,
      `products/${OWNER_ID}/${IMAGE_ID}.webp/extra`,
      `products//${OWNER_ID}/${IMAGE_ID}.webp`,
    ];

    for (const value of invalid) {
      expect(
        () => validateMediaPath(value),
        `expected ${JSON.stringify(value)} to be rejected`,
      ).toThrow(MediaStorageError);
    }
  });
});

describe("local media storage", () => {
  it("writes atomically, returns a public URL, and removes the file", async () => {
    const storage = localStorage();
    const buffer = Buffer.from("fake-webp-bytes");

    await storage.put(RELATIVE_PATH, buffer, "image/webp");

    const target = path.join(
      tempDir,
      "products",
      OWNER_ID,
      `${IMAGE_ID}.webp`,
    );

    expect(await readFile(target)).toEqual(buffer);
    expect(
      await readdir(path.join(tempDir, "products", OWNER_ID)),
    ).toEqual([`${IMAGE_ID}.webp`]);
    expect(storage.publicUrl(RELATIVE_PATH)).toBe(
      `https://api.example.com/media/${RELATIVE_PATH}`,
    );

    await storage.remove([RELATIVE_PATH]);
    await expect(stat(target)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      stat(path.join(tempDir, "products", OWNER_ID)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      (await stat(path.join(tempDir, "products"))).isDirectory(),
    ).toBe(true);
    await expect(
      storage.remove([RELATIVE_PATH]),
    ).resolves.toBeUndefined();
  });

  it("keeps an owner folder that still contains another file", async () => {
    const storage = localStorage();
    const secondPath = `products/${OWNER_ID}/${IMAGE_ID_2}.webp`;

    await storage.put(RELATIVE_PATH, Buffer.from("first"), "image/webp");
    await storage.put(secondPath, Buffer.from("second"), "image/webp");

    await storage.remove([RELATIVE_PATH]);

    expect(
      (
        await stat(
          path.join(tempDir, "products", OWNER_ID, `${IMAGE_ID_2}.webp`),
        )
      ).isFile(),
    ).toBe(true);
    expect(
      (await stat(path.join(tempDir, "products", OWNER_ID))).isDirectory(),
    ).toBe(true);
    expect(
      (await stat(path.join(tempDir, "products"))).isDirectory(),
    ).toBe(true);
  });

  it("removes only empty owner folders and never top folders", async () => {
    const storage = localStorage();
    const emptyOwnerPath = path.join(tempDir, "content", OWNER_ID);

    await mkdir(emptyOwnerPath, { recursive: true });
    await storage.put(RELATIVE_PATH, Buffer.from("kept"), "image/webp");

    await storage.removeEmptyDirectories([
      `content/${OWNER_ID}`,
      `products/${OWNER_ID}`,
      "products",
      "content",
    ]);

    await expect(stat(emptyOwnerPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      (await stat(path.join(tempDir, "products", OWNER_ID))).isDirectory(),
    ).toBe(true);
    expect(
      (await stat(path.join(tempDir, "products"))).isDirectory(),
    ).toBe(true);
    expect(
      (await stat(path.join(tempDir, "content"))).isDirectory(),
    ).toBe(true);
  });

  it("rejects a non-WebP content type for local writes", async () => {
    const storage = localStorage();

    await expect(
      storage.put(RELATIVE_PATH, Buffer.from("x"), "image/png"),
    ).rejects.toBeInstanceOf(MediaStorageError);
  });

  it("rejects invalid delete paths and never touches files outside MEDIA_DIR", async () => {
    const outsideDir = await mkdtemp(
      path.join(tmpdir(), "zayn-media-outside-"),
    );
    const outsideFile = path.join(outsideDir, "outside.webp");
    await writeFile(outsideFile, "outside");

    try {
      const storage = localStorage();

      await expect(
        storage.remove([`../${path.basename(outsideFile)}`]),
      ).rejects.toBeInstanceOf(MediaStorageError);
      await expect(
        storage.remove([outsideFile]),
      ).rejects.toBeInstanceOf(MediaStorageError);
      expect(await readFile(outsideFile, "utf8")).toBe("outside");
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("refuses writes below the free-space threshold", async () => {
    const storage = localStorage({
      minFreeMb: 1,
      getFreeBytes: async () => 0,
    });

    await expect(
      storage.put(RELATIVE_PATH, Buffer.from("x"), "image/webp"),
    ).rejects.toBeInstanceOf(MediaStorageCapacityError);
    expect(new MediaStorageCapacityError()).toBeInstanceOf(
      MediaStorageError,
    );

    const target = path.join(
      tempDir,
      "products",
      OWNER_ID,
      `${IMAGE_ID}.webp`,
    );
    await expect(stat(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("allows writes when free space cannot be determined and warns once", async () => {
    const warn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      const storage = localStorage({
        getFreeBytes: async () => {
          throw new Error("statfs unavailable");
        },
      });

      await storage.put(
        RELATIVE_PATH,
        Buffer.from("webp"),
        "image/webp",
      );
      await storage.put(
        `content/${OWNER_ID}/${IMAGE_ID}.webp`,
        Buffer.from("webp"),
        "image/webp",
      );

      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("does not follow a symlink outside MEDIA_DIR", async (context) => {
    const outsideDir = await mkdtemp(
      path.join(tmpdir(), "zayn-media-outside-"),
    );
    const outsideFile = path.join(outsideDir, "outside.webp");
    await writeFile(outsideFile, "outside");

    const linkPath = path.join(
      tempDir,
      "products",
      OWNER_ID,
      `${IMAGE_ID}.webp`,
    );

    try {
      await mkdir(path.dirname(linkPath), { recursive: true });

      try {
        await symlink(outsideFile, linkPath, "file");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;

        if (
          code === "EPERM" ||
          code === "EACCES" ||
          code === "ENOSYS" ||
          code === "EINVAL"
        ) {
          console.warn(
            `symlink creation is not available on this platform (${code}); skipping escape test`,
          );
          context.skip();
          return;
        }

        throw error;
      }

      const storage = localStorage();

      expect(
        await resolveExistingMediaFile(tempDir, RELATIVE_PATH),
      ).toBeNull();
      await storage.remove([RELATIVE_PATH]);
      expect(await readFile(outsideFile, "utf8")).toBe("outside");
      expect(await stat(outsideFile)).toBeTruthy();
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});

describe("media storage factory", () => {
  it("requires a directory and base URL", () => {
    expect(() => createMediaStorage({})).toThrow(MediaStorageError);
    expect(() =>
      createMediaStorage({
        mediaDir: tempDir,
      }),
    ).toThrow(MediaStorageError);
  });

  it("creates local storage for an absolute directory", () => {
    const storage = createMediaStorage({
      mediaDir: tempDir,
      publicBaseUrl: "http://localhost:4000",
      minFreeMb: 0,
    });

    expect(storage).toBeInstanceOf(LocalMediaStorage);
  });
});
