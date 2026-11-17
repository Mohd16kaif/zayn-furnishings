import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LogSender,
  ResendSender,
  createEmailSender,
  formatFromHeader,
} from "../src/emails/sender";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("email sender selection", () => {
  it("uses Resend when both the API key and from address are set", () => {
    const sender = createEmailSender({
      resendApiKey: "re_test_key",
      emailFrom: "orders@example.com",
    });

    expect(sender.name).toBe("resend");
  });

  it("falls back to the log sender when configuration is incomplete", () => {
    expect(createEmailSender({ resendApiKey: "re_test_key" }).name).toBe(
      "log",
    );
    expect(
      createEmailSender({ emailFrom: "orders@example.com" }).name,
    ).toBe("log");
  });

  it("builds a safe From header with the store name", () => {
    expect(
      formatFromHeader(
        'Zayn Furnishings"\r\nBcc: bad@example.com',
        "Orders <orders@example.com>",
      ),
    ).toBe("Zayn Furnishings Bcc: bad@example.com <orders@example.com>");
  });

  it("logs without calling the network", async () => {
    const result = await new LogSender().send({
      to: "buyer@example.com",
      subject: "Test",
      html: "<p>Test</p>",
      text: "Test",
    });

    expect(result.providerMessageId).toMatch(/^log_/);
  });
});

describe("ResendSender idempotency", () => {
  it("sends the dedupe key as an Idempotency-Key header", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ id: "pm_1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sender = new ResendSender("re_test_key", "orders@example.com");

    await sender.send({
      to: "buyer@example.com",
      subject: "Test",
      html: "<p>Test</p>",
      text: "Test",
      dedupeKey: "out_for_delivery:order-1",
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string>;

    expect(headers["Idempotency-Key"]).toBe(
      "out_for_delivery:order-1",
    );
    expect(headers["Idempotency-Key"].length).toBeLessThanOrEqual(256);
  });

  it("omits the header when there is no dedupe key", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ id: "pm_1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sender = new ResendSender("re_test_key", "orders@example.com");

    await sender.send({
      to: "buyer@example.com",
      subject: "Test",
      html: "<p>Test</p>",
      text: "Test",
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string>;

    expect(headers["Idempotency-Key"]).toBeUndefined();
  });
});
