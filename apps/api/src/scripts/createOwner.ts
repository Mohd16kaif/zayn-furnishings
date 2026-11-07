import { env } from "../config/env";
import { connection, db } from "../db/client";
import { adminUsers } from "../db/schema";

async function main() {
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

  const inserted = await db
    .insert(adminUsers)
    .values({
      email,
      role: "owner",
      isActive: true,
    })
    .onConflictDoNothing({ target: adminUsers.email })
    .returning({ id: adminUsers.id });

  if (inserted.length > 0) {
    console.log(`Owner admin created: ${email}`);
  } else {
    console.log(`Owner admin already existed: ${email}`);
  }
}

main()
  .catch(() => {
    console.error("Owner admin bootstrap failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection?.end();
  });
