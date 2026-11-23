import "dotenv/config";
import { migratePlainPostgres } from "../db/plainPostgresMigrations";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error("DATABASE_URL is required to run migrations.");
    process.exitCode = 1;
    return;
  }

  await migratePlainPostgres(databaseUrl);
  console.log("Role bootstrap and Drizzle migrations complete.");
}

main().catch((error) => {
  console.error(
    "Migration failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
