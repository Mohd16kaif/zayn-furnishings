import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { env } from "../config/env";
import type { Database } from "../db/client";
import {
  adminLoginCodes,
  adminSessions,
  adminUsers,
  auditLog,
  type AdminUser,
} from "../db/schema";
import {
  ADMIN_LOGIN_CODE_MAX_ATTEMPTS,
  ADMIN_SESSION_LAST_USED_TOUCH_MS,
  ADMIN_USER_AGENT_MAX_LENGTH,
  adminLoginCodeExpiry,
  adminLoginCodeMatches,
  adminSessionExpiry,
  generateAdminLoginCode,
  generateAdminSessionToken,
  hashAdminLoginCode,
  hashAdminSessionToken,
  normalizeAdminEmail,
} from "./adminAuth";

export type AdminIdentity = {
  id: string;
  email: string;
  name: string | null;
  role: AdminUser["role"];
};

export type RequestAdminLoginCodeInput = {
  email: string;
  requestedIp: string | null;
  userAgent: string | null;
};

export type RequestAdminLoginCodeResult =
  | { sent: false; code: null; admin: null }
  | { sent: true; code: string; admin: AdminUser };

export type VerifyAdminLoginCodeInput = {
  email: string;
  code: string;
  requestedIp: string | null;
  userAgent: string | null;
};

export type VerifyAdminLoginCodeResult =
  | {
      ok: true;
      sessionToken: string;
      expiresAt: Date;
      admin: AdminIdentity;
    }
  | { ok: false; reason: "invalid" | "locked" };

export type AdminSessionLookup = {
  admin: AdminIdentity;
  sessionId: string;
};

type TimeOptions = {
  now?: Date;
};

function toIdentity(admin: AdminUser): AdminIdentity {
  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  };
}

function truncateUserAgent(value: string | null): string | null {
  return value ? value.slice(0, ADMIN_USER_AGENT_MAX_LENGTH) : null;
}

export async function requestAdminLoginCode(
  database: Database,
  input: RequestAdminLoginCodeInput,
  options: TimeOptions & {
    secret?: string;
    generateCode?: () => string;
  } = {},
): Promise<RequestAdminLoginCodeResult> {
  const email = normalizeAdminEmail(input.email);

  if (!email) {
    return { sent: false, code: null, admin: null };
  }

  const now = options.now ?? new Date();
  const secret = options.secret ?? env.ADMIN_AUTH_SECRET;
  const code = (options.generateCode ?? generateAdminLoginCode)();
  const codeHash = hashAdminLoginCode(email, code, secret);

  const [admin] = await database
    .select()
    .from(adminUsers)
    .where(
      and(
        eq(adminUsers.isActive, true),
        sql`lower(${adminUsers.email}) = ${email}`,
      ),
    )
    .limit(1);

  if (!admin) {
    return { sent: false, code: null, admin: null };
  }

  await database.transaction(async (tx) => {
    await tx
      .update(adminLoginCodes)
      .set({ consumedAt: now })
      .where(
        and(
          eq(adminLoginCodes.email, email),
          isNull(adminLoginCodes.consumedAt),
        ),
      );

    await tx.insert(adminLoginCodes).values({
      email,
      adminUserId: admin.id,
      codeHash,
      expiresAt: adminLoginCodeExpiry(now),
      requestedIp: input.requestedIp,
      createdAt: now,
    });
  });

  return { sent: true, code, admin };
}

export async function verifyAdminLoginCode(
  database: Database,
  input: VerifyAdminLoginCodeInput,
  options: TimeOptions & { secret?: string } = {},
): Promise<VerifyAdminLoginCodeResult> {
  const email = normalizeAdminEmail(input.email);

  if (!email) {
    return { ok: false, reason: "invalid" };
  }

  const now = options.now ?? new Date();
  const secret = options.secret ?? env.ADMIN_AUTH_SECRET;
  const code = input.code.trim();

  const [candidate] = await database
    .select()
    .from(adminLoginCodes)
    .where(
      and(
        eq(adminLoginCodes.email, email),
        isNull(adminLoginCodes.consumedAt),
        gt(adminLoginCodes.expiresAt, now),
      ),
    )
    .orderBy(desc(adminLoginCodes.createdAt))
    .limit(1);

  if (!candidate) {
    return { ok: false, reason: "invalid" };
  }

  const [attempt] = await database
    .update(adminLoginCodes)
    .set({
      attempts: sql`${adminLoginCodes.attempts} + 1`,
    })
    .where(
      and(
        eq(adminLoginCodes.id, candidate.id),
        isNull(adminLoginCodes.consumedAt),
        gt(adminLoginCodes.expiresAt, now),
        lt(adminLoginCodes.attempts, ADMIN_LOGIN_CODE_MAX_ATTEMPTS),
      ),
    )
    .returning({
      id: adminLoginCodes.id,
      adminUserId: adminLoginCodes.adminUserId,
      codeHash: adminLoginCodes.codeHash,
      attempts: adminLoginCodes.attempts,
    });

  if (!attempt) {
    return { ok: false, reason: "invalid" };
  }

  if (
    !adminLoginCodeMatches(email, code, secret, attempt.codeHash)
  ) {
    if (attempt.attempts >= ADMIN_LOGIN_CODE_MAX_ATTEMPTS) {
      await recordLockoutAudit(database, {
        adminUserId: attempt.adminUserId,
        email,
        requestedIp: input.requestedIp,
      });
    }

    return {
      ok: false,
      reason:
        attempt.attempts >= ADMIN_LOGIN_CODE_MAX_ATTEMPTS
          ? "locked"
          : "invalid",
    };
  }

  if (!attempt.adminUserId) {
    return { ok: false, reason: "invalid" };
  }

  const sessionToken = generateAdminSessionToken();
  const expiresAt = adminSessionExpiry(now);
  const userAgent = truncateUserAgent(input.userAgent);

  const admin = await database.transaction(async (tx) => {
    const [consumed] = await tx
      .update(adminLoginCodes)
      .set({ consumedAt: now })
      .where(
        and(
          eq(adminLoginCodes.id, attempt.id),
          isNull(adminLoginCodes.consumedAt),
        ),
      )
      .returning({ id: adminLoginCodes.id });

    if (!consumed) {
      return null;
    }

    const [activeAdmin] = await tx
      .select()
      .from(adminUsers)
      .where(
        and(
          eq(adminUsers.id, attempt.adminUserId!),
          eq(adminUsers.isActive, true),
        ),
      )
      .limit(1);

    if (!activeAdmin) {
      return null;
    }

    await tx.insert(adminSessions).values({
      adminUserId: activeAdmin.id,
      tokenHash: hashAdminSessionToken(sessionToken),
      expiresAt,
      lastUsedAt: now,
      createdIp: input.requestedIp,
      userAgent,
      createdAt: now,
    });

    await tx.insert(auditLog).values({
      adminUserId: activeAdmin.id,
      action: "admin.login",
      entity: "admin_user",
      entityId: activeAdmin.id,
      details: {
        method: "email_code",
        requestedIp: input.requestedIp,
      },
    });

    return activeAdmin;
  });

  if (!admin) {
    return { ok: false, reason: "invalid" };
  }

  return {
    ok: true,
    sessionToken,
    expiresAt,
    admin: toIdentity(admin),
  };
}

export async function findAdminByAdminSession(
  database: Database,
  sessionToken: string,
  options: TimeOptions = {},
): Promise<AdminSessionLookup | null> {
  const now = options.now ?? new Date();
  const tokenHash = hashAdminSessionToken(sessionToken);

  const [row] = await database
    .select({
      session: adminSessions,
      admin: adminUsers,
    })
    .from(adminSessions)
    .innerJoin(
      adminUsers,
      eq(adminSessions.adminUserId, adminUsers.id),
    )
    .where(
      and(
        eq(adminSessions.tokenHash, tokenHash),
        gt(adminSessions.expiresAt, now),
        isNull(adminSessions.revokedAt),
        eq(adminUsers.isActive, true),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  if (
    now.getTime() - row.session.lastUsedAt.getTime() >=
    ADMIN_SESSION_LAST_USED_TOUCH_MS
  ) {
    await database
      .update(adminSessions)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(adminSessions.id, row.session.id),
          lt(
            adminSessions.lastUsedAt,
            new Date(
              now.getTime() - ADMIN_SESSION_LAST_USED_TOUCH_MS,
            ),
          ),
        ),
      );
  }

  return {
    admin: toIdentity(row.admin),
    sessionId: row.session.id,
  };
}

export async function revokeAdminSession(
  database: Database,
  sessionToken: string,
  options: TimeOptions = {},
): Promise<boolean> {
  const now = options.now ?? new Date();
  const [revoked] = await database
    .update(adminSessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(
          adminSessions.tokenHash,
          hashAdminSessionToken(sessionToken),
        ),
        isNull(adminSessions.revokedAt),
      ),
    )
    .returning({
      id: adminSessions.id,
      adminUserId: adminSessions.adminUserId,
    });

  if (!revoked) {
    return false;
  }

  await database.insert(auditLog).values({
    adminUserId: revoked.adminUserId,
    action: "admin.logout",
    entity: "admin_session",
    entityId: revoked.id,
    details: { method: "email_code" },
  });

  return true;
}

async function recordLockoutAudit(
  database: Database,
  input: {
    adminUserId: string | null;
    email: string;
    requestedIp: string | null;
  },
): Promise<void> {
  try {
    await database.insert(auditLog).values({
      adminUserId: input.adminUserId,
      action: "admin.login.lockout",
      entity: "admin_user",
      entityId: input.adminUserId,
      details: {
        email: input.email,
        attempts: ADMIN_LOGIN_CODE_MAX_ATTEMPTS,
        requestedIp: input.requestedIp,
      },
    });
  } catch (error) {
    console.error(
      "Admin login lockout audit failed:",
      error instanceof Error ? error.message : error,
    );
  }
}
