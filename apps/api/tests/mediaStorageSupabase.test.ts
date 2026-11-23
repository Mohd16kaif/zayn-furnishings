import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  getPublicUrl: vi.fn(),
  from: vi.fn(),
}));

vi.mock("../src/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: state.from,
    },
  }),
}));

import {
  MediaStorageError,
  SupabaseMediaStorage,
} from "../src/lib/mediaStorage";

state.from.mockImplementation(() => ({
  upload: state.upload,
  remove: state.remove,
  getPublicUrl: state.getPublicUrl,
}));

const PATH = "products/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp";
const BUFFER = Buffer.from("webp");

describe("Supabase media driver compatibility", () => {
  it("keeps the existing bucket, upload options, remove call, and public URL", async () => {
    state.upload.mockResolvedValue({ error: null });
    state.remove.mockResolvedValue({ error: null });
    state.getPublicUrl.mockReturnValue({
      data: { publicUrl: `https://supabase.example/${PATH}` },
    });

    const storage = new SupabaseMediaStorage();

    await storage.put(PATH, BUFFER, "image/webp");

    expect(state.from).toHaveBeenCalledWith("product-images");
    expect(state.upload).toHaveBeenCalledWith(PATH, BUFFER, {
      contentType: "image/webp",
      cacheControl: "31536000",
      upsert: false,
    });

    expect(storage.publicUrl(PATH)).toBe(
      `https://supabase.example/${PATH}`,
    );
    expect(state.getPublicUrl).toHaveBeenCalledWith(PATH);

    await storage.remove([PATH]);
    expect(state.remove).toHaveBeenCalledWith([PATH]);
  });

  it("does not call remove for an empty path list", async () => {
    state.remove.mockClear();

    const storage = new SupabaseMediaStorage();
    await storage.remove([]);

    expect(state.remove).not.toHaveBeenCalled();
  });

  it("throws the existing Storage error message when upload fails", async () => {
    state.upload.mockResolvedValue({
      error: { message: "storage rejected upload" },
    });

    const storage = new SupabaseMediaStorage();

    await expect(
      storage.put(PATH, BUFFER, "image/webp"),
    ).rejects.toMatchObject({
      name: "MediaStorageError",
      message: "storage rejected upload",
    });
  });

  it("throws when remove fails", async () => {
    state.remove.mockResolvedValue({
      error: { message: "storage rejected remove" },
    });

    const storage = new SupabaseMediaStorage();

    await expect(storage.remove([PATH])).rejects.toBeInstanceOf(
      MediaStorageError,
    );
  });
});
