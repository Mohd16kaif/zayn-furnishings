import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db } from "../db/client";
import {
  customerSessions,
  customers,
  type Customer,
} from "../db/schema";

export const SESSION_COOKIE_NAME = "zf_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const LAST_SEEN_TOUCH_MS = 60 * 1000;

declare global {
  namespace Express {
    interface Request {
      customer?: Customer;
      customerSessionId?: string;
    }
  }
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function maskPhone(phone: string): string {
  return `+1******${phone.slice(-4)}`;
}

export function serializeCustomer(customer: Customer) {
  return {
    id: customer.id,
    phone_masked: maskPhone(customer.phone),
    email: customer.email,
    name: customer.name,
  };
}

function bearerToken(req: Request): string | null {
  const header = req.get("authorization");

  if (!header) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());

  return match?.[1]?.trim() || null;
}

export async function requireCustomer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!db) {
    res.status(500).json({ error: "Database is not configured" });
    return;
  }

  const token = bearerToken(req);

  if (!token) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }

  const now = new Date();
  const [row] = await db
    .select({
      session: customerSessions,
      customer: customers,
    })
    .from(customerSessions)
    .innerJoin(customers, eq(customerSessions.customerId, customers.id))
    .where(
      and(
        eq(customerSessions.tokenHash, hashSessionToken(token)),
        gt(customerSessions.expiresAt, now),
      ),
    )
    .limit(1);

  if (!row) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }

  req.customer = row.customer;
  req.customerSessionId = row.session.id;

  if (now.getTime() - row.session.lastSeenAt.getTime() > LAST_SEEN_TOUCH_MS) {
    await db
      .update(customerSessions)
      .set({ lastSeenAt: now })
      .where(eq(customerSessions.id, row.session.id));
  }

  next();
}
