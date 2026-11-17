import { describe, expect, it } from "vitest";
import {
  LogSender,
  createEmailSender,
  formatFromHeader,
} from "../src/emails/sender";

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
