import { describe, expect, it } from "vitest";
import {
  resolveMediaUrl,
  type MediaUrlConfig,
} from "../src/lib/mediaUrls";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const IMAGE_ID = "22222222-2222-4222-8222-222222222222";
const MEDIA_PATH = `products/${PRODUCT_ID}/${IMAGE_ID}.webp`;
const STORED_URL = `https://old-project.supabase.co/storage/v1/object/public/product-images/${MEDIA_PATH}`;
const BASE_URL = "https://api.example.com";

const LOCAL: MediaUrlConfig = {
  driver: "local",
  publicBaseUrl: BASE_URL,
};

const SUPABASE: MediaUrlConfig = {
  driver: "supabase",
  publicBaseUrl: BASE_URL,
};

describe("resolveMediaUrl", () => {
  it("builds a media URL from the storage path with the local driver", () => {
    expect(resolveMediaUrl(MEDIA_PATH, STORED_URL, LOCAL)).toBe(
      `${BASE_URL}/media/${MEDIA_PATH}`,
    );
  });

  it("builds a media URL when the stored URL is missing", () => {
    expect(resolveMediaUrl(MEDIA_PATH, null, LOCAL)).toBe(
      `${BASE_URL}/media/${MEDIA_PATH}`,
    );
  });

  it("keeps the stored URL when there is no storage path", () => {
    expect(resolveMediaUrl(null, STORED_URL, LOCAL)).toBe(STORED_URL);
    expect(resolveMediaUrl(undefined, STORED_URL, LOCAL)).toBe(STORED_URL);
    expect(resolveMediaUrl("", STORED_URL, LOCAL)).toBe(STORED_URL);
  });

  it("keeps the stored URL for the Supabase driver", () => {
    expect(resolveMediaUrl(MEDIA_PATH, STORED_URL, SUPABASE)).toBe(
      STORED_URL,
    );
  });

  it("normalizes trailing slashes in the public base URL", () => {
    expect(
      resolveMediaUrl(MEDIA_PATH, STORED_URL, {
        driver: "local",
        publicBaseUrl: `${BASE_URL}/`,
      }),
    ).toBe(`${BASE_URL}/media/${MEDIA_PATH}`);
    expect(
      resolveMediaUrl(MEDIA_PATH, STORED_URL, {
        driver: "local",
        publicBaseUrl: `${BASE_URL}///`,
      }),
    ).toBe(`${BASE_URL}/media/${MEDIA_PATH}`);
  });

  it("keeps the stored URL when the base URL is missing or unusable", () => {
    for (const publicBaseUrl of [
      null,
      undefined,
      "",
      "not a url",
      "ftp://api.example.com",
      "https://user:pass@api.example.com",
      "https://api.example.com?cache=1",
      "https://api.example.com#fragment",
    ]) {
      expect(
        resolveMediaUrl(MEDIA_PATH, STORED_URL, {
          driver: "local",
          publicBaseUrl,
        }),
        `expected ${JSON.stringify(publicBaseUrl)} to fall back`,
      ).toBe(STORED_URL);
    }
  });

  it("keeps the stored URL for hostile storage paths", () => {
    const hostilePaths = [
      "../outside.webp",
      `products/${PRODUCT_ID}/../${IMAGE_ID}.webp`,
      `products/${PRODUCT_ID}/..%2f${IMAGE_ID}.webp`,
      `/etc/passwd`,
      `C:\\media\\products\\${IMAGE_ID}.webp`,
      `products\\${PRODUCT_ID}\\${IMAGE_ID}.webp`,
      `products/${PRODUCT_ID}/${IMAGE_ID}.webp\0`,
      `other/${PRODUCT_ID}/${IMAGE_ID}.webp`,
      `products/${PRODUCT_ID}/${IMAGE_ID}.png`,
      `products/${PRODUCT_ID}/not-a-uuid.webp`,
      `products//${PRODUCT_ID}/${IMAGE_ID}.webp`,
      `https://evil.example/media/${MEDIA_PATH}`,
      `products/${PRODUCT_ID}/${IMAGE_ID}.webp?x=1`,
    ];

    for (const hostilePath of hostilePaths) {
      expect(
        resolveMediaUrl(hostilePath, STORED_URL, LOCAL),
        `expected ${JSON.stringify(hostilePath)} to fall back`,
      ).toBe(STORED_URL);
    }
  });
});
