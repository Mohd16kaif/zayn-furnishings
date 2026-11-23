import { readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const API_ROOT = path.resolve(__dirname, "../..");

export const BOOTSTRAP_SQL_PATH = path.join(
  API_ROOT,
  "db-bootstrap",
  "0000_roles.sql",
);
export const MIGRATIONS_FOLDER = path.join(API_ROOT, "drizzle");

export function readBootstrapSql(): string {
  return readFileSync(BOOTSTRAP_SQL_PATH, "utf8");
}

export function readMigrationJournal(): Array<{ when: number }> {
  const journalPath = path.join(MIGRATIONS_FOLDER, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries?: Array<{ when?: unknown }>;
  };

  if (!Array.isArray(journal.entries)) {
    throw new Error("Migration journal is missing its entries array.");
  }

  return journal.entries.map((entry, index) => {
    if (typeof entry.when !== "number") {
      throw new Error(`Migration journal entry ${index} is missing "when".`);
    }

    return { when: entry.when };
  });
}

export async function migratePlainPostgres(
  databaseUrl: string,
): Promise<void> {
  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });

  try {
    await client.unsafe(readBootstrapSql());
    const database = drizzle(client);
    await migrate(database, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}
