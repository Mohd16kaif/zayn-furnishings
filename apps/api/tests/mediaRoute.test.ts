import cors from "cors";
import express from "express";
import helmet from "helmet";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerMediaRoute } from "../src/routes/media";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const IMAGE_ID = "22222222-2222-4222-8222-222222222222";
const RELATIVE_PATH = `products/${OWNER_ID}/${IMAGE_ID}.webp`;
const STOREFRONT_ORIGIN = "http://localhost:3000";
const BODY = Buffer.from("fake-webp-body");

let tempDir: string;
let servers: Server[] = [];

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "zayn-media-route-"));
  await mkdir(path.join(tempDir, "products", OWNER_ID), {
    recursive: true,
  });
  await writeFile(
    path.join(tempDir, "products", OWNER_ID, `${IMAGE_ID}.webp`),
    BODY,
  );
});

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        }),
    ),
  );
  servers = [];
  await rm(tempDir, { recursive: true, force: true });
});

async function startApp(options: {
  mediaDir: string;
}): Promise<string> {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: STOREFRONT_ORIGIN }));
  registerMediaRoute(app, options);

  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
  const address = server.address() as AddressInfo;

  return `http://127.0.0.1:${address.port}`;
}

function rawRequest(
  baseUrl: string,
  rawPath: string,
  method = "GET",
): Promise<{ status: number; body: string }> {
  const url = new URL(baseUrl);

  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: rawPath,
        method,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body,
          });
        });
      },
    );

    request.on("error", reject);
    request.end();
  });
}

describe("media serving route", () => {
  it("serves a WebP image with fixed headers and CORS from the storefront origin", async () => {
    const baseUrl = await startApp({ mediaDir: tempDir });

    const response = await fetch(
      `${baseUrl}/media/${RELATIVE_PATH}`,
      {
        headers: { origin: STOREFRONT_ORIGIN },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("x-content-type-options")).toBe(
      "nosniff",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(
      response.headers.get("cross-origin-resource-policy"),
    ).toBe("cross-origin");
    expect(response.headers.get("access-control-allow-origin")).toBe(
      STOREFRONT_ORIGIN,
    );
    expect(response.headers.get("content-length")).toBe(
      String(BODY.length),
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(BODY);
  });

  it("supports HEAD without a body", async () => {
    const baseUrl = await startApp({ mediaDir: tempDir });

    const response = await fetch(
      `${baseUrl}/media/${RELATIVE_PATH}`,
      { method: "HEAD" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("content-length")).toBe(
      String(BODY.length),
    );
    expect(await response.text()).toBe("");
  });

  it("allows only GET and HEAD", async () => {
    const baseUrl = await startApp({ mediaDir: tempDir });

    const response = await fetch(
      `${baseUrl}/media/${RELATIVE_PATH}`,
      { method: "POST" },
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });

  it("returns 404 for missing, invalid, traversal, and directory paths", async () => {
    const baseUrl = await startApp({ mediaDir: tempDir });

    const missing = await fetch(
      `${baseUrl}/media/products/${OWNER_ID}/33333333-3333-4333-8333-333333333333.webp`,
    );
    expect(missing.status).toBe(404);

    const wrongExtension = await fetch(
      `${baseUrl}/media/products/${OWNER_ID}/x.txt`,
    );
    expect(wrongExtension.status).toBe(404);

    const traversal = await fetch(
      `${baseUrl}/media/products/%2e%2e/${OWNER_ID}/${IMAGE_ID}.webp`,
    );
    expect(traversal.status).toBe(404);

    const directoryListing = await fetch(
      `${baseUrl}/media/products/`,
    );
    expect(directoryListing.status).toBe(404);

    const rawTraversal = await rawRequest(
      baseUrl,
      `/media/products/${OWNER_ID}/..\\${IMAGE_ID}.webp`,
    );
    expect(rawTraversal.status).toBe(404);
  });

  it("does not serve a symlink that resolves outside MEDIA_DIR", async (context) => {
    const outsideDir = await mkdtemp(
      path.join(tmpdir(), "zayn-media-route-outside-"),
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
      await rm(linkPath, { force: true });

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
            `symlink creation is not available on this platform (${code}); skipping media route escape test`,
          );
          context.skip();
          return;
        }

        throw error;
      }

      const baseUrl = await startApp({ mediaDir: tempDir });
      const response = await fetch(
        `${baseUrl}/media/${RELATIVE_PATH}`,
      );

      expect(response.status).toBe(404);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});
