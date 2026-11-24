import type { NextFunction, Request, Response } from "express";
import { db } from "../db/client";
import { findAdminByAdminSession } from "../lib/adminAuthService";

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

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const sessionToken = req.get("x-admin-session")?.trim();

  if (!sessionToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!db) {
    res.status(500).json({ error: "Database is not configured" });
    return;
  }

  try {
    const lookup = await findAdminByAdminSession(db, sessionToken);

    if (!lookup) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    req.admin = lookup.admin;
    next();
  } catch (error) {
    console.error(
      "Admin session verification failed:",
      error instanceof Error ? error.message : error,
    );
    res.status(401).json({ error: "Unauthorized" });
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
