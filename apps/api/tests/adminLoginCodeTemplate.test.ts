import { describe, expect, it } from "vitest";
import { renderAdminLoginCode } from "../src/emails/templates/adminLoginCode";

describe("admin login code email", () => {
  it("includes the code, expiry, IP, and escaped store name", () => {
    const rendered = renderAdminLoginCode({
      code: "123456",
      expiresMinutes: 10,
      storeName: 'Zayn <script>alert("x")</script>',
      requestedIp: "203.0.113.10",
    });

    expect(rendered.subject).toContain("admin sign-in code");
    expect(rendered.html).toContain("123456");
    expect(rendered.html).toContain("203.0.113.10");
    expect(rendered.text).toContain("123456");
    expect(rendered.text).toContain("203.0.113.10");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.text).toContain("expires in 10 minutes");
  });
});
