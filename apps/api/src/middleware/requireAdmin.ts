import { and, eq, sql } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db } from "../db/client";
import { adminUsers, auditLog } from "../db/schema";
import { getSupabaseAdmin } from "../lib/supabase";

export type AdminContext = {
  id: string;
  email: string;
  name: string | null;
  role: "owner" | "staff";
};

declare global {
  namespace Express {
    interface Request {
      admin?: AdminContext;
    }
  }
}

function getBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = getBearerToken(req.headers.authorization);

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!db) {
    res.status(500).json({ error: "Database is not configured" });
    return;
  }

  let userId: string;
  let userEmail: string;

  try {
    const { data, error } = await getSupabaseAdmin().auth.getUser(token);

    if (error || !data.user?.email) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!data.user.email_confirmed_at) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    userId = data.user.id;
    userEmail = data.user.email.toLowerCase();
  } catch (error) {
    console.error(
      "Admin token verification failed:",
      error instanceof Error ? error.message : error,
    );
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const [admin] = await db
      .select()
      .from(adminUsers)
      .where(
        and(
          eq(adminUsers.isActive, true),
          sql`lower(${adminUsers.email}) = ${userEmail}`,
        ),
      )
      .limit(1);

    if (!admin) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    if (admin.authUserId && admin.authUserId !== userId) {
      console.warn("admin auth_user_id mismatch");
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    if (!admin.authUserId) {
      await db
        .update(adminUsers)
        .set({ authUserId: userId, updatedAt: new Date() })
        .where(eq(adminUsers.id, admin.id));

      await db.insert(auditLog).values({
        adminUserId: admin.id,
        action: "admin.login",
        entity: "admin_user",
        entityId: admin.id,
        details: { email: admin.email, firstLogin: true },
      });
    }

    req.admin = {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
    };

    next();
  } catch (error) {
    console.error(
      "Admin lookup failed:",
      error instanceof Error ? error.message : error,
    );
    res.status(500).json({ error: "Server error" });
  }
}

export function requireRole(role: AdminContext["role"]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (req.admin.role !== role) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    next();
  };
}
