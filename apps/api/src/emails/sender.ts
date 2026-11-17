import { randomUUID } from "node:crypto";
import { env } from "../config/env";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 8_000;

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  fromName?: string;
  dedupeKey?: string;
};

export type EmailSendResult = {
  providerMessageId: string;
};

export interface EmailSender {
  name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export type EmailSenderConfig = {
  resendApiKey?: string;
  emailFrom?: string;
};

function cleanAddress(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function addressOnly(value: string): string {
  const match = /<([^>]+)>/.exec(value);

  return cleanAddress(match?.[1] ?? value);
}

export function formatFromHeader(name: string, emailFrom: string): string {
  const cleanName = name.replace(/[\r\n"]/g, " ").replace(/\s+/g, " ").trim();
  const address = addressOnly(emailFrom);

  return cleanName ? `${cleanName} <${address}>` : address;
}

export class LogSender implements EmailSender {
  name = "log";

  async send(_message: EmailMessage): Promise<EmailSendResult> {
    return { providerMessageId: `log_${randomUUID()}` };
  }
}

export class ResendSender implements EmailSender {
  name = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly emailFrom: string,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const idempotencyKey = message.dedupeKey
      ?.replace(/[\r\n]+/g, "")
      .trim();
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey
          ? { "Idempotency-Key": idempotencyKey }
          : {}),
      },
      body: JSON.stringify({
        from: formatFromHeader(
          message.fromName ?? "",
          this.emailFrom,
        ),
        to: [cleanAddress(message.to)],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo
          ? { reply_to: cleanAddress(message.replyTo) }
          : {}),
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Resend request failed with HTTP ${response.status}.`);
    }

    const data: unknown = await response.json().catch(() => null);
    const providerMessageId =
      typeof data === "object" &&
      data !== null &&
      typeof (data as { id?: unknown }).id === "string"
        ? (data as { id: string }).id
        : null;

    if (!providerMessageId) {
      throw new Error("Resend did not return a message id.");
    }

    return { providerMessageId };
  }
}

export function createEmailSender(
  config: EmailSenderConfig = {},
): EmailSender {
  if (config.resendApiKey && config.emailFrom) {
    return new ResendSender(config.resendApiKey, config.emailFrom);
  }

  return new LogSender();
}

let activeSender: EmailSender | null = null;

export function getEmailSender(): EmailSender {
  if (activeSender) {
    return activeSender;
  }

  activeSender = createEmailSender({
    resendApiKey: env.RESEND_API_KEY,
    emailFrom: env.EMAIL_FROM,
  });

  console.log(`Email sender: ${activeSender.name}`);

  if (
    env.NODE_ENV === "production" &&
    (!env.RESEND_API_KEY || !env.EMAIL_FROM)
  ) {
    console.warn(
      "WARNING: Transactional email is not configured for production. Set RESEND_API_KEY and EMAIL_FROM or emails will only be logged.",
    );
  }

  return activeSender;
}

export function initializeEmailSender(): void {
  getEmailSender();
}
