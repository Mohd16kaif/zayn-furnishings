import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env";

export type Database = PostgresJsDatabase<Record<string, never>>;

let db: Database | null = null;
let connection: ReturnType<typeof postgres> | null = null;

function connectionOptions(): {
  max: number;
  ssl?: "require" | "disable";
} {
  const options: { max: number; ssl?: "require" | "disable" } = {
    max: 1,
  };

  // When DATABASE_SSL is unset, do not pass an SSL option at all. This keeps
  // the driver's existing behavior, including any sslmode in DATABASE_URL.
  if (env.DATABASE_SSL) {
    options.ssl = env.DATABASE_SSL;
  }

  return options;
}

if (env.DATABASE_URL) {
  connection = postgres(env.DATABASE_URL, connectionOptions());
  db = drizzle(connection);
}

export { db, connection };

export async function isDatabaseHealthy(): Promise<boolean> {
  if (!db) {
    return false;
  }

  try {
    await db.execute(sql`select 1`);
    return true;
  } catch (error) {
    console.error("Database health check failed:", error);
    return false;
  }
}
