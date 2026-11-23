import { randomBytes } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import type { Database } from "../src/db/client";
import {
  adminLoginCodes,
  adminSessions,
  adminUsers,
  auditLog,
  notificationsLog,
} from "../src/db/schema";
import {
  ADMIN_LOGIN_CODE_TTL_MS,
  adminLoginCodeMatches,
  hashAdminSessionToken,
} from "../src/lib/adminAuth";
import {
  findAdminByAdminSession,
  requestAdminLoginCode,
  revokeAdminSession,
  verifyAdminLoginCode,
} from "../src/lib/adminAuthService";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = TEST_DATABASE_URL
  ? describe
  : describe.skip;
const SECRET = `test-admin-auth-secret-${"x".repeat(16)}`;
const REQUEST_IP = "203.0.113.50";
const USER_AGENT = "vitest-admin-auth";

let client: ReturnType<typeof postgres> | null = null;
let database: Database;
const adminIds: string[] = [];
const emails: string[] = [];

function uniqueEmail(label: string): string {
  return `admin-auth-test-${label}-${Date.now()}-${randomBytes(
    4,
  ).toString("hex")}@example.com`;
}

async function createAdmin(
  role: "owner" | "staff",
  isActive = true,
) {
  const email = uniqueEmail(role);
  const [admin] = await database
    .insert(adminUsers)
    .values({ email, role, isActive })
    .returning();

  adminIds.push(admin.id);
  emails.push(email);

  return admin;
}

async function requestCode(
  admin: { email: string },
  code: string,
  now: Date,
) {
  return requestAdminLoginCode(
    database,
    {
      email: admin.email,
      requestedIp: REQUEST_IP,
      userAgent: USER_AGENT,
    },
    {
      now,
      secret: SECRET,
      generateCode: () => code,
    },
  );
}

async function verifyCode(
  email: string,
  code: string,
  now: Date,
) {
  return verifyAdminLoginCode(
    database,
    {
      email,
      code,
      requestedIp: REQUEST_IP,
      userAgent: USER_AGENT,
    },
    { now, secret: SECRET },
  );
}

async function notificationCount(): Promise<number> {
  const [row] = await database
    .select({ value: count() })
    .from(notificationsLog);

  return Number(row?.value ?? 0);
}

beforeAll(() => {
  if (!TEST_DATABASE_URL) {
    return;
  }

  const url = new URL(TEST_DATABASE_URL);

  if (url.hostname.toLowerCase().includes("supabase")) {
    throw new Error(
      "Refusing to run admin auth integration tests against Supabase.",
    );
  }

  client = postgres(TEST_DATABASE_URL, {
    max: 10,
    prepare: false,
    onnotice: () => {},
  });
  database = drizzle(client);
});

afterAll(async () => {
  if (!client) {
    return;
  }

  if (adminIds.length > 0) {
    await database
      .delete(auditLog)
      .where(inArray(auditLog.adminUserId, adminIds));
  }

  if (emails.length > 0) {
    await database
      .delete(adminLoginCodes)
      .where(inArray(adminLoginCodes.email, emails));
    await database
      .delete(adminUsers)
      .where(inArray(adminUsers.id, adminIds));
  }

  await client.end();
});

describeWithDatabase("admin email-code login database behavior", () => {
  it(
    "stores a hash, invalidates old codes, and creates a single-use session",
    async () => {
      const admin = await createAdmin("owner");
      const notificationsBefore = await notificationCount();
      const now = new Date("2026-02-01T12:00:00.000Z");

      const first = await requestCode(admin, "111111", now);

      expect(first.sent).toBe(true);

      if (!first.sent) {
        throw new Error("Code was not sent.");
      }

      const [firstCode] = await database
        .select()
        .from(adminLoginCodes)
        .where(eq(adminLoginCodes.email, admin.email))
        .orderBy(desc(adminLoginCodes.createdAt))
        .limit(1);

      expect(firstCode.codeHash).not.toBe("111111");
      expect(firstCode.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(
        adminLoginCodeMatches(
          admin.email,
          "111111",
          SECRET,
          firstCode.codeHash,
        ),
      ).toBe(true);
      expect(firstCode.expiresAt.getTime()).toBe(
        now.getTime() + ADMIN_LOGIN_CODE_TTL_MS,
      );
      expect(firstCode.attempts).toBe(0);
      expect(firstCode.consumedAt).toBeNull();
      expect(firstCode.adminUserId).toBe(admin.id);

      const secondNow = new Date(now.getTime() + 60_000);
      const second = await requestCode(admin, "222222", secondNow);

      expect(second.sent).toBe(true);

      const rows = await database
        .select()
        .from(adminLoginCodes)
        .where(eq(adminLoginCodes.email, admin.email))
        .orderBy(asc(adminLoginCodes.createdAt));

      expect(rows).toHaveLength(2);
      expect(rows[0].consumedAt).not.toBeNull();
      expect(rows[1].consumedAt).toBeNull();

      const oldResult = await verifyCode(
        admin.email,
        "111111",
        new Date(secondNow.getTime() + 60_000),
      );

      expect(oldResult.ok).toBe(false);

      const verified = await verifyCode(
        admin.email,
        "222222",
        new Date(secondNow.getTime() + 60_000),
      );

      expect(verified.ok).toBe(true);

      if (!verified.ok) {
        throw new Error("Code verification failed.");
      }

      expect(verified.admin.role).toBe("owner");
      expect(verified.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const [session] = await database
        .select()
        .from(adminSessions)
        .where(eq(adminSessions.adminUserId, admin.id))
        .orderBy(desc(adminSessions.createdAt))
        .limit(1);

      expect(session.tokenHash).not.toBe(verified.sessionToken);
      expect(session.tokenHash).toBe(
        hashAdminSessionToken(verified.sessionToken),
      );
      expect(session.expiresAt.getTime()).toBe(
        new Date(secondNow.getTime() + 60_000).getTime() +
          7 * 24 * 60 * 60 * 1000,
      );

      const reused = await verifyCode(
        admin.email,
        "222222",
        new Date(secondNow.getTime() + 120_000),
      );

      expect(reused.ok).toBe(false);

      const audits = await database
        .select()
        .from(auditLog)
        .where(eq(auditLog.adminUserId, admin.id));
      const loginAudit = audits.find(
        (row) => row.action === "admin.login",
      );

      expect(loginAudit).toBeTruthy();

      const auditDetails = JSON.stringify(
        audits.map((row) => row.details),
      );

      expect(auditDetails).not.toContain("111111");
      expect(auditDetails).not.toContain("222222");
      expect(auditDetails).not.toContain(verified.sessionToken);
      expect(await notificationCount()).toBe(notificationsBefore);
    },
    60_000,
  );

  it(
    "does not create codes for unknown or inactive admins",
    async () => {
      const now = new Date("2026-02-02T12:00:00.000Z");
      const unknownEmail = uniqueEmail("unknown");
      const unknown = await requestAdminLoginCode(
        database,
        {
          email: unknownEmail,
          requestedIp: REQUEST_IP,
          userAgent: USER_AGENT,
        },
        {
          now,
          secret: SECRET,
          generateCode: () => "333333",
        },
      );

      expect(unknown.sent).toBe(false);

      const inactive = await createAdmin("staff", false);
      const inactiveResult = await requestCode(
        inactive,
        "333333",
        now,
      );

      expect(inactiveResult.sent).toBe(false);

      const rows = await database
        .select()
        .from(adminLoginCodes)
        .where(eq(adminLoginCodes.email, inactive.email));

      expect(rows).toHaveLength(0);
    },
    60_000,
  );

  it(
    "rejects codes and sessions after an admin is deactivated",
    async () => {
      const admin = await createAdmin("staff");
      const now = new Date("2026-02-05T12:00:00.000Z");

      await requestCode(admin, "888888", now);
      await database
        .update(adminUsers)
        .set({ isActive: false })
        .where(eq(adminUsers.id, admin.id));

      const inactiveVerify = await verifyCode(
        admin.email,
        "888888",
        new Date(now.getTime() + 60_000),
      );

      expect(inactiveVerify.ok).toBe(false);

      await database
        .update(adminUsers)
        .set({ isActive: true })
        .where(eq(adminUsers.id, admin.id));
      await requestCode(
        admin,
        "999999",
        new Date(now.getTime() + 120_000),
      );
      const verified = await verifyCode(
        admin.email,
        "999999",
        new Date(now.getTime() + 180_000),
      );

      expect(verified.ok).toBe(true);

      if (!verified.ok) {
        throw new Error("Code verification failed.");
      }

      await database
        .update(adminUsers)
        .set({ isActive: false })
        .where(eq(adminUsers.id, admin.id));

      const inactiveSession = await findAdminByAdminSession(
        database,
        verified.sessionToken,
        { now: new Date(now.getTime() + 240_000) },
      );

      expect(inactiveSession).toBeNull();
    },
    60_000,
  );

  it(
    "rejects expired codes and locks a code after five wrong attempts, including concurrent attempts",
    async () => {
      const admin = await createAdmin("staff");
      const now = new Date("2026-02-03T12:00:00.000Z");

      await requestCode(admin, "444444", now);

      const expired = await verifyCode(
        admin.email,
        "444444",
        new Date(now.getTime() + ADMIN_LOGIN_CODE_TTL_MS + 1),
      );

      expect(expired.ok).toBe(false);

      const secondCodeNow = new Date(
        now.getTime() + ADMIN_LOGIN_CODE_TTL_MS + 120_000,
      );

      await requestCode(admin, "555555", secondCodeNow);
      const wrongAttempts = await Promise.all(
        Array.from({ length: 10 }, () =>
          verifyCode(
            admin.email,
            "000000",
            new Date(secondCodeNow.getTime() + 60_000),
          ),
        ),
      );

      expect(wrongAttempts.every((result) => !result.ok)).toBe(true);

      const [lockedCode] = await database
        .select()
        .from(adminLoginCodes)
        .where(eq(adminLoginCodes.email, admin.email))
        .orderBy(desc(adminLoginCodes.createdAt))
        .limit(1);

      expect(lockedCode.attempts).toBe(5);

      const correctAfterLock = await verifyCode(
        admin.email,
        "555555",
        new Date(secondCodeNow.getTime() + 120_000),
      );

      expect(correctAfterLock.ok).toBe(false);

      const lockoutAudits = await database
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.adminUserId, admin.id),
            eq(auditLog.action, "admin.login.lockout"),
          ),
        );

      expect(lockoutAudits.length).toBeGreaterThanOrEqual(1);
    },
    60_000,
  );

  it(
    "expires sessions, limits sliding updates, preserves role, and revokes on logout",
    async () => {
      const admin = await createAdmin("staff");
      const now = new Date("2026-02-04T12:00:00.000Z");

      await requestCode(admin, "666666", now);
      const verified = await verifyCode(
        admin.email,
        "666666",
        now,
      );

      expect(verified.ok).toBe(true);

      if (!verified.ok) {
        throw new Error("Code verification failed.");
      }

      const [createdSession] = await database
        .select()
        .from(adminSessions)
        .where(eq(adminSessions.adminUserId, admin.id))
        .orderBy(desc(adminSessions.createdAt))
        .limit(1);

      expect(createdSession.tokenHash).toBe(
        hashAdminSessionToken(verified.sessionToken),
      );

      const atOneMinute = await findAdminByAdminSession(
        database,
        verified.sessionToken,
        { now: new Date(now.getTime() + 60_000) },
      );

      expect(atOneMinute?.admin.role).toBe("staff");

      const [beforeTouch] = await database
        .select()
        .from(adminSessions)
        .where(eq(adminSessions.id, createdSession.id))
        .limit(1);

      expect(beforeTouch.lastUsedAt.getTime()).toBe(now.getTime());

      const atSixMinutes = await findAdminByAdminSession(
        database,
        verified.sessionToken,
        { now: new Date(now.getTime() + 6 * 60_000) },
      );

      expect(atSixMinutes?.admin.role).toBe("staff");

      const [afterTouch] = await database
        .select()
        .from(adminSessions)
        .where(eq(adminSessions.id, createdSession.id))
        .limit(1);

      expect(afterTouch.lastUsedAt.getTime()).toBe(
        now.getTime() + 6 * 60_000,
      );

      const expiredSession = await findAdminByAdminSession(
        database,
        verified.sessionToken,
        { now: new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000) },
      );

      expect(expiredSession).toBeNull();

      await requestCode(
        admin,
        "777777",
        new Date(now.getTime() + 2 * 60_000),
      );
      const second = await verifyCode(
        admin.email,
        "777777",
        new Date(now.getTime() + 2 * 60_000),
      );

      expect(second.ok).toBe(true);

      if (!second.ok) {
        throw new Error("Second verification failed.");
      }

      const revoked = await revokeAdminSession(
        database,
        second.sessionToken,
        { now: new Date(now.getTime() + 3 * 60_000) },
      );

      expect(revoked).toBe(true);

      const afterLogout = await findAdminByAdminSession(
        database,
        second.sessionToken,
        { now: new Date(now.getTime() + 3 * 60_000) },
      );

      expect(afterLogout).toBeNull();

      const logoutAudits = await database
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.adminUserId, admin.id),
            eq(auditLog.action, "admin.logout"),
          ),
        );

      expect(logoutAudits.length).toBeGreaterThanOrEqual(1);
    },
    60_000,
  );
});
