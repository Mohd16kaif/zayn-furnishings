import { count, lt } from "drizzle-orm";
import { connection, db } from "../db/client";
import { adminLoginCodes, adminSessions } from "../db/schema";

const SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  if (!db) {
    console.error("DATABASE_URL is required.");
    process.exitCode = 1;
    return;
  }

  const dryRun = process.argv.includes("--dry-run");
  const now = new Date();
  const sessionCutoff = new Date(now.getTime() - SESSION_RETENTION_MS);

  const [codeCount] = await db
    .select({ value: count() })
    .from(adminLoginCodes)
    .where(lt(adminLoginCodes.expiresAt, now));
  const [sessionCount] = await db
    .select({ value: count() })
    .from(adminSessions)
    .where(lt(adminSessions.createdAt, sessionCutoff));

  const expiredCodes = Number(codeCount?.value ?? 0);
  const oldSessions = Number(sessionCount?.value ?? 0);

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          dry_run: true,
          expired_admin_login_codes: expiredCodes,
          admin_sessions_older_than_30_days: oldSessions,
          session_cutoff: sessionCutoff.toISOString(),
        },
        null,
        2,
      ),
    );
    return;
  }

  await db
    .delete(adminLoginCodes)
    .where(lt(adminLoginCodes.expiresAt, now));
  await db
    .delete(adminSessions)
    .where(lt(adminSessions.createdAt, sessionCutoff));

  console.log(
    JSON.stringify(
      {
        dry_run: false,
        deleted_expired_admin_login_codes: expiredCodes,
        deleted_admin_sessions_older_than_30_days: oldSessions,
        session_cutoff: sessionCutoff.toISOString(),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(
      "Admin auth purge failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection?.end();
  });
