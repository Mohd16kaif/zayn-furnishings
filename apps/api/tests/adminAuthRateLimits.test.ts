import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  adminCodeEmailRateLimiter,
  adminCodeIpRateLimiter,
  adminCodeResendGapLimiter,
} from "../src/lib/adminAuthRateLimits";

let server: Server | null = null;
let baseUrl = "";
let counter = 0;

async function start(limiter: express.RequestHandler): Promise<void> {
  const app = express();

  app.set("trust proxy", 1);
  app.use(express.json());
  app.post("/test", limiter, (_req, res) => {
    res.json({ ok: true });
  });

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => {
    server!.once("listening", () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@example.com`;
}

async function post(
  email: string,
  ip: string,
): Promise<Response> {
  return fetch(`${baseUrl}/test`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ email }),
  });
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    server = null;
  }
});

describe("admin code request rate limits", () => {
  it("limits requests per IP to 10 per hour", async () => {
    await start(adminCodeIpRateLimiter);
    const ip = `198.51.100.${counter + 10}`;

    for (let index = 0; index < 10; index += 1) {
      expect((await post(unique("ip"), ip)).status).toBe(200);
    }

    const limited = await post(unique("ip"), ip);

    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({
      error: "Too many requests. Please try again later.",
    });
  });

  it("limits requests per email to 5 per hour", async () => {
    await start(adminCodeEmailRateLimiter);
    const email = unique("email");
    const ipBase = counter + 100;

    for (let index = 0; index < 5; index += 1) {
      expect(
        (await post(email, `198.51.100.${ipBase + index}`)).status,
      ).toBe(200);
    }

    const limited = await post(
      email,
      `198.51.100.${ipBase + 5}`,
    );

    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({
      error: "Too many requests. Please try again later.",
    });
  });

  it("enforces a 60-second resend gap per email", async () => {
    await start(adminCodeResendGapLimiter);
    const email = unique("resend");
    const ip = `198.51.100.${counter + 200}`;

    expect((await post(email, ip)).status).toBe(200);

    const limited = await post(email, ip);

    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({
      error: "Too many requests. Please try again later.",
    });
  });
});
