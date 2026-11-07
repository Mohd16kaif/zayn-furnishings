import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env";

type Database = PostgresJsDatabase<Record<string, never>>;

let db: Database | null = null;
let connection: ReturnType<typeof postgres> | null = null;

if (env.DATABASE_URL) {
  connection = postgres(env.DATABASE_URL, { max: 1, prepare: false });
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
