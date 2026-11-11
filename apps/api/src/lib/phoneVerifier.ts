import { normalizeUsPhone } from "@zayn/shared";
import twilio from "twilio";
import { env } from "../config/env";

export interface PhoneVerifier {
  start(phoneE164: string): Promise<void>;
  check(phoneE164: string, code: string): Promise<boolean>;
}

export type PhoneVerifierName = "twilio" | "dev-stub" | "unavailable";

export interface PhoneVerifierConfig {
  accountSid?: string;
  authToken?: string;
  verifyServiceSid?: string;
}

/**
 * Pure selection rule: Twilio wins only when all three credentials exist.
 * Production without Twilio is unavailable; non-production falls back to
 * the fixed-code development stub.
 */
export function selectPhoneVerifierName(
  config: PhoneVerifierConfig,
  nodeEnv: string,
): PhoneVerifierName {
  if (config.accountSid && config.authToken && config.verifyServiceSid) {
    return "twilio";
  }

  return nodeEnv === "production" ? "unavailable" : "dev-stub";
}

export class TwilioVerifier implements PhoneVerifier {
  private readonly client: ReturnType<typeof twilio>;
  private readonly serviceSid: string;

  constructor(config: {
    accountSid: string;
    authToken: string;
    verifyServiceSid: string;
  }) {
    this.client = twilio(config.accountSid, config.authToken);
    this.serviceSid = config.verifyServiceSid;
  }

  async start(phoneE164: string): Promise<void> {
    await this.client.verify.v2
      .services(this.serviceSid)
      .verifications.create({
        to: phoneE164,
        channel: "sms",
      });
  }

  async check(phoneE164: string, code: string): Promise<boolean> {
    const result = await this.client.verify.v2
      .services(this.serviceSid)
      .verificationChecks.create({
        to: phoneE164,
        code,
      });

    return result.status === "approved";
  }
}

export class DevStubVerifier implements PhoneVerifier {
  constructor(nodeEnv: string = env.NODE_ENV) {
    if (nodeEnv === "production") {
      throw new Error("DevStubVerifier cannot be used in production.");
    }
  }

  async start(phoneE164: string): Promise<void> {
    if (!normalizeUsPhone(phoneE164)) {
      throw new Error("A valid US phone number is required.");
    }
  }

  async check(phoneE164: string, code: string): Promise<boolean> {
    return normalizeUsPhone(phoneE164) !== null && code === "123456";
  }
}

function createPhoneVerifier(): PhoneVerifier | null {
  const name = selectPhoneVerifierName(
    {
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      verifyServiceSid: env.TWILIO_VERIFY_SERVICE_SID,
    },
    env.NODE_ENV,
  );

  if (name === "twilio") {
    return new TwilioVerifier({
      accountSid: env.TWILIO_ACCOUNT_SID!,
      authToken: env.TWILIO_AUTH_TOKEN!,
      verifyServiceSid: env.TWILIO_VERIFY_SERVICE_SID!,
    });
  }

  if (name === "dev-stub") {
    return new DevStubVerifier(env.NODE_ENV);
  }

  return null;
}

const verifier = createPhoneVerifier();

export const phoneVerifier = verifier;

export const activePhoneVerifierName: PhoneVerifierName = verifier
  ? selectPhoneVerifierName(
      {
        accountSid: env.TWILIO_ACCOUNT_SID,
        authToken: env.TWILIO_AUTH_TOKEN,
        verifyServiceSid: env.TWILIO_VERIFY_SERVICE_SID,
      },
      env.NODE_ENV,
    )
  : "unavailable";
