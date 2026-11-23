import { and, eq, sql } from "drizzle-orm";
import { env } from "../config/env";
import { connection, db } from "../db/client";
import { adminSessions, adminUsers, auditLog } from "../db/schema";
import {
  generateSessionToken,
  hashSessionToken,
} from "../lib/sessionTokens";

const DEV_SESSION_TTL_MS = 60 * 60 * 1000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function isLocalDatabaseUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  try {
    return LOCAL_HOSTS.has(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (env.APP_ENV !== "development") {
    console.error(
      "Refusing to mint a dev admin session outside APP_ENV=development.",
    );
    process.exitCode = 1;
    return;
  }

  if (!isLocalDatabaseUrl(env.DATABASE_URL)) {
    console.error(
      "Refusing to mint a dev admin session: DATABASE_URL must point at localhost or 127.0.0.1.",
    );
    process.exitCode = 1;
    return;
  }

  if (!env.OWNER_EMAIL) {
    console.error("OWNER_EMAIL is required.");
    process.exitCode = 1;
    return;
  }

  if (!db) {
    console.error("DATABASE_URL is required.");
    process.exitCode = 1;
    return;
  }

  const email = env.OWNER_EMAIL.toLowerCase();
  const [admin] = await db
    .select()
    .from(adminUsers)
    .where(
      and(
        eq(adminUsers.isActive, true),
        eq(adminUsers.role, "owner"),
        sql`lower(${adminUsers.email}) = ${email}`,
      ),
    )
    .limit(1);

  if (!admin) {
    console.error(
      `No active owner admin found for OWNER_EMAIL. Run admin:create-owner first.`,
    );
    process.exitCode = 1;
    return;
  }

  const sessionToken = generateSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEV_SESSION_TTL_MS);

  await db.insert(adminSessions).values({
    adminUserId: admin.id,
    tokenHash: hashSessionToken(sessionToken),
    expiresAt,
    lastUsedAt: now,
    createdIp: "127.0.0.1",
    userAgent: "admin:mint-dev-session",
    createdAt: now,
  });

  await db.insert(auditLog).values({
    adminUserId: admin.id,
    action: "admin.dev_session",
    entity: "admin_user",
    entityId: admin.id,
    details: {
      method: "dev_script",
      expiresAt: expiresAt.toISOString(),
    },
  });

  console.error(
    `Dev admin session created for ${admin.email}; expires ${expiresAt.toISOString()}.`,
  );
  console.log(sessionToken);
}

main()
  .catch((error) => {
    console.error(
      "Dev admin session mint failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection?.end();
  });
