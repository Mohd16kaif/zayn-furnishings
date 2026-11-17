import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractWebhookSecrets,
  maskSecretEnd,
  parseEnv,
  redactSecrets,
  replaceEnvValue,
  secretsMatch,
  updateEnvFileValue,
} from "../../../scripts/stripe-listen-lib.mjs";

let tempDir: string | null = null;

async function makeTempEnv(content: string): Promise<string> {
  tempDir = await mkdtemp(path.join(tmpdir(), "stripe-listen-"));

  const filePath = path.join(tempDir, ".env");
  await writeFile(filePath, content, "utf8");

  return filePath;
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("parseEnv", () => {
  it("parses plain, quoted, exported, and commented values", () => {
    const parsed = parseEnv(
      [
        "# comment",
        "PLAIN=value",
        "export EXPORTED='quoted value'",
        'DOUBLE="line\\nbreak"',
        "TRAILING=keep # comment",
        "EMPTY=",
      ].join("\r\n"),
    );

    expect(parsed).toMatchObject({
      PLAIN: "value",
      EXPORTED: "quoted value",
      DOUBLE: "line\nbreak",
      TRAILING: "keep",
      EMPTY: "",
    });
  });
});

describe("redactSecrets", () => {
  it("redacts webhook secrets and API keys to their last four characters", () => {
    const input =
      "secret whsec_fake1234567890 key sk_test_fakeabcdef9876 alt rk_live_fake5432";
    const redacted = redactSecrets(input);

    expect(redacted).toContain("whsec_...7890");
    expect(redacted).toContain("sk_...9876");
    expect(redacted).toContain("rk_...5432");
    expect(redacted).not.toContain("whsec_fake1234567890");
    expect(redacted).not.toContain("sk_test_fakeabcdef9876");
    expect(redacted).not.toContain("rk_live_fake5432");
  });

  it("extracts unique webhook secrets from listener output", () => {
    expect(
      extractWebhookSecrets(
        "Ready whsec_aaa1111 and whsec_aaa1111 again, plus whsec_bbb2222",
      ),
    ).toEqual(["whsec_aaa1111", "whsec_bbb2222"]);
  });
});

describe("secret comparison", () => {
  it("compares exact values and masks all but the last four", () => {
    const secret = "whsec_fake1234567890";

    expect(maskSecretEnd(secret)).toBe("7890");
    expect(maskSecretEnd("")).toBe("missing");
    expect(secretsMatch(secret, secret)).toBe(true);
    expect(secretsMatch(secret, "whsec_fake9999")).toBe(false);
    expect(secretsMatch("", "")).toBe(false);
  });
});

describe("replaceEnvValue", () => {
  it("replaces only the secret line and preserves CRLF and other lines", () => {
    const original =
      "FIRST=one\r\nSTRIPE_WEBHOOK_SECRET=whsec_old\r\nLAST=two\r\n";
    const next = replaceEnvValue(
      original,
      "STRIPE_WEBHOOK_SECRET",
      "whsec_new",
    );

    expect(next).toBe(
      "FIRST=one\r\nSTRIPE_WEBHOOK_SECRET=whsec_new\r\nLAST=two\r\n",
    );
  });

  it("preserves order and leaves unrelated text untouched", () => {
    const original = "# header\nA=1\nB = two\nSTRIPE_WEBHOOK_SECRET = old\nC=3\n";
    const next = replaceEnvValue(
      original,
      "STRIPE_WEBHOOK_SECRET",
      "whsec_new",
    );

    expect(next).toBe(
      "# header\nA=1\nB = two\nSTRIPE_WEBHOOK_SECRET = whsec_new\nC=3\n",
    );
  });

  it("appends the key when it is missing", () => {
    expect(
      replaceEnvValue("A=1\r\nB=2\r\n", "STRIPE_WEBHOOK_SECRET", "whsec_new"),
    ).toBe("A=1\r\nB=2\r\nSTRIPE_WEBHOOK_SECRET=whsec_new\r\n");
    expect(replaceEnvValue("A=1", "STRIPE_WEBHOOK_SECRET", "whsec_new")).toBe(
      "A=1\nSTRIPE_WEBHOOK_SECRET=whsec_new",
    );
  });
});

describe("updateEnvFileValue", () => {
  it("updates a temporary env file without a BOM and keeps line endings", async () => {
    const filePath = await makeTempEnv(
      "FIRST=one\r\nSTRIPE_WEBHOOK_SECRET=whsec_old\r\nLAST=two\r\n",
    );

    await updateEnvFileValue(
      filePath,
      "STRIPE_WEBHOOK_SECRET",
      "whsec_fake9999",
    );

    const content = await readFile(filePath, "utf8");

    expect(content.startsWith("\uFEFF")).toBe(false);
    expect(content).toBe(
      "FIRST=one\r\nSTRIPE_WEBHOOK_SECRET=whsec_fake9999\r\nLAST=two\r\n",
    );
  });

  it("appends the secret to a temporary env file when missing", async () => {
    const filePath = await makeTempEnv("FIRST=one\nLAST=two\n");

    await updateEnvFileValue(
      filePath,
      "STRIPE_WEBHOOK_SECRET",
      "whsec_fake9999",
    );

    expect(await readFile(filePath, "utf8")).toBe(
      "FIRST=one\nLAST=two\nSTRIPE_WEBHOOK_SECRET=whsec_fake9999\n",
    );
  });
});
