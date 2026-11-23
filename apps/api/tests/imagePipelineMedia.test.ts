import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  class MediaStorageError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "MediaStorageError";
    }
  }

  class MediaStorageCapacityError extends MediaStorageError {
    constructor(message: string) {
      super(message);
      this.name = "MediaStorageCapacityError";
    }
  }

  return {
    put: vi.fn(),
    remove: vi.fn(),
    publicUrl: vi.fn(),
    MediaStorageError,
    MediaStorageCapacityError,
  };
});

vi.mock("../src/lib/mediaStorage", () => ({
  getMediaStorage: () => ({
    driver: "local",
    put: state.put,
    remove: state.remove,
    publicUrl: state.publicUrl,
  }),
  MediaStorageError: state.MediaStorageError,
  MediaStorageCapacityError: state.MediaStorageCapacityError,
}));

import {
  deleteImageObjects,
  uploadImageObject,
} from "../src/lib/imagePipeline";

beforeEach(() => {
  state.put.mockReset();
  state.remove.mockReset();
  state.publicUrl.mockReset();
});

describe("image pipeline media storage wrapper", () => {
  it("writes through the active driver and returns its public URL", async () => {
    state.put.mockResolvedValue(undefined);
    state.publicUrl.mockImplementation(
      (relativePath: string) =>
        `http://localhost:4000/media/${relativePath}`,
    );

    const result = await uploadImageObject({
      folder: "products",
      ownerId: "11111111-1111-4111-8111-111111111111",
      buffer: Buffer.from("webp"),
      errorMessage: "upload failed",
    });

    expect(result.path).toMatch(
      /^products\/11111111-1111-4111-8111-111111111111\/[0-9a-f-]+\.webp$/,
    );
    expect(state.put).toHaveBeenCalledWith(
      result.path,
      Buffer.from("webp"),
      "image/webp",
    );
    expect(result.url).toBe(
      `http://localhost:4000/media/${result.path}`,
    );
  });

  it("maps a local capacity error to HTTP 507", async () => {
    state.put.mockRejectedValue(
      new state.MediaStorageCapacityError(
        "The media server is low on disk space.",
      ),
    );

    await expect(
      uploadImageObject({
        folder: "content",
        ownerId: "11111111-1111-4111-8111-111111111111",
        buffer: Buffer.from("webp"),
        errorMessage: "upload failed",
      }),
    ).rejects.toMatchObject({
      name: "HttpError",
      status: 507,
      message: "The media server is low on disk space.",
    });
  });

  it("keeps the existing generic upload error message for storage failures", async () => {
    state.put.mockRejectedValue(
      new state.MediaStorageError("driver failure"),
    );

    await expect(
      uploadImageObject({
        folder: "categories",
        ownerId: "11111111-1111-4111-8111-111111111111",
        buffer: Buffer.from("webp"),
        errorMessage: "We could not save the image. Please try again.",
      }),
    ).rejects.toMatchObject({
      name: "HttpError",
      status: 500,
      message: "We could not save the image. Please try again.",
    });
  });

  it("rethrows unexpected errors so Supabase SDK failures keep existing handling", async () => {
    state.put.mockRejectedValue(new Error("sdk failure"));

    await expect(
      uploadImageObject({
        folder: "products",
        ownerId: "11111111-1111-4111-8111-111111111111",
        buffer: Buffer.from("webp"),
        errorMessage: "upload failed",
      }),
    ).rejects.toThrow("sdk failure");
  });

  it("deletes through the active driver and logs failures", async () => {
    state.remove.mockResolvedValue(undefined);

    await deleteImageObjects(["products/a/b.webp"], "test objects");

    expect(state.remove).toHaveBeenCalledWith([
      "products/a/b.webp",
    ]);

    state.remove.mockRejectedValue(new Error("remove failed"));
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      await deleteImageObjects(["products/a/b.webp"], "test objects");
      expect(error).toHaveBeenCalledWith(
        "Failed to delete test objects:",
        "remove failed",
      );
    } finally {
      error.mockRestore();
    }
  });

  it("does not call the driver for an empty delete list", async () => {
    await deleteImageObjects([]);

    expect(state.remove).not.toHaveBeenCalled();
  });
});
