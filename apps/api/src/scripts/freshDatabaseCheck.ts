import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getTableName, isTable } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "../db/schema";
import {
  MIGRATIONS_FOLDER,
  migratePlainPostgres,
  readMigrationJournal,
} from "../db/plainPostgresMigrations";

export type FreshCheckFailure = {
  step: string;
  message: string;
  statement?: string;
};

export type FreshCheckResult = {
  ok: boolean;
  failure?: FreshCheckFailure;
  tables: string[];
  rlsTables: string[];
  migrations: number;
};

function failure(
  step: string,
  message: string,
  statement?: string,
): FreshCheckResult {
  return {
    ok: false,
    failure: { step, message, statement },
    tables: [],
    rlsTables: [],
    migrations: 0,
  };
}

function errorDetails(error: unknown): {
  message: string;
  statement?: string;
} {
  const message = error instanceof Error ? error.message : String(error);

  if (typeof error !== "object" || error === null || !("query" in error)) {
    return { message };
  }

  const query = (error as { query?: unknown }).query;

  return {
    message,
    statement: typeof query === "string" ? query : undefined,
  };
}

function expectedSchemaTables(): string[] {
  const tables = new Set<string>();

  for (const value of Object.values(schema)) {
    if (isTable(value)) {
      tables.add(getTableName(value));
    }
  }

  return [...tables].sort();
}

function expectedRlsTables(): string[] {
  const pattern =
    /ALTER\s+TABLE\s+(?:"public"\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
  const tables = new Set<string>();

  const files = readdirSync(MIGRATIONS_FOLDER)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_FOLDER, file), "utf8");

    for (const match of sql.matchAll(pattern)) {
      tables.add(match[1]);
    }
  }

  return [...tables].sort();
}

function parseTestDatabaseUrl(
  raw: string | undefined,
): { url: URL } | { error: string } {
  if (!raw || raw.trim() === "") {
    return { error: "TEST_DATABASE_URL is not set." };
  }

  let url: URL;

  try {
    url = new URL(raw.trim());
  } catch {
    return { error: "TEST_DATABASE_URL is not a valid URL." };
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return {
      error: "TEST_DATABASE_URL must use the postgres:// or postgresql:// protocol.",
    };
  }

  return { url };
}

function setDifference(left: string[], right: Set<string>): string[] {
  return left.filter((value) => !right.has(value));
}

export async function runFreshDatabaseCheck(): Promise<FreshCheckResult> {
  const parsed = parseTestDatabaseUrl(process.env.TEST_DATABASE_URL);

  if ("error" in parsed) {
    return failure("read TEST_DATABASE_URL", parsed.error);
  }

  const testUrl = parsed.url;
  const expectedTables = expectedSchemaTables();
  const expectedRls = expectedRlsTables();
  const expectedHistory = readMigrationJournal()
    .map((entry) => String(entry.when))
    .sort();

  if (expectedTables.length === 0) {
    return failure(
      "read Drizzle schema",
      "No tables were found in the Drizzle schema.",
    );
  }

  const suffix = `${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
  const databaseName = `zayn_fresh_${suffix}`;

  if (!/^[a-z0-9_]+$/.test(databaseName)) {
    return failure(
      "build throwaway database name",
      "Generated database name contains unsupported characters.",
    );
  }

  const maintenanceUrl = new URL(testUrl.toString());
  maintenanceUrl.pathname = "/postgres";

  const throwawayUrl = new URL(testUrl.toString());
  throwawayUrl.pathname = `/${databaseName}`;

  let admin: ReturnType<typeof postgres> | null = null;
  let created = false;
  let currentStep = "connect to maintenance database";

  try {
    admin = postgres(maintenanceUrl.toString(), {
      max: 1,
      prepare: false,
    });

    currentStep = "create throwaway database";
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    created = true;

    currentStep = "run role bootstrap and migrations";
    await migratePlainPostgres(throwawayUrl.toString());

    currentStep = "run bootstrap and migrations a second time";
    await migratePlainPostgres(throwawayUrl.toString());

    currentStep = "inspect throwaway database";
    const client = postgres(throwawayUrl.toString(), {
      max: 1,
      prepare: false,
    });

    try {
      const tableRows = await client.unsafe<{ table_name: string }[]>(
        `select table_name
           from information_schema.tables
          where table_schema = 'public'
            and table_type = 'BASE TABLE'
          order by table_name`,
      );
      const actualTables = new Set(
        tableRows.map((row) => row.table_name),
      );
      const missingTables = setDifference(expectedTables, actualTables);

      if (missingTables.length > 0) {
        return failure(
          "expected tables exist",
          `Missing tables: ${missingTables.join(", ")}`,
        );
      }

      const rlsRows = await client.unsafe<
        { table_name: string; rls_enabled: boolean }[]
      >(
        `select c.relname as table_name,
                c.relrowsecurity as rls_enabled
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relkind = 'r'
          order by c.relname`,
      );
      const actualRls = new Map(
        rlsRows.map((row) => [row.table_name, row.rls_enabled]),
      );
      const rlsMismatches = expectedTables.filter((table) => {
        const shouldBeEnabled = expectedRls.includes(table);
        return Boolean(actualRls.get(table)) !== shouldBeEnabled;
      });

      if (rlsMismatches.length > 0) {
        return failure(
          "RLS matches migrations",
          `RLS mismatch for tables: ${rlsMismatches.join(", ")}`,
        );
      }

      const roleRows = await client.unsafe<
        { rolname: string; rolcanlogin: boolean }[]
      >(
        `select rolname, rolcanlogin
           from pg_roles
          where rolname in ('anon', 'authenticated')
          order by rolname`,
      );
      const roles = new Map(
        roleRows.map((row) => [row.rolname, row.rolcanlogin]),
      );

      for (const role of ["anon", "authenticated"]) {
        if (!roles.has(role)) {
          return failure(
            "bootstrap roles exist",
            `Role "${role}" was not created.`,
          );
        }

        if (roles.get(role) !== false) {
          return failure(
            "bootstrap roles cannot log in",
            `Role "${role}" must be NOLOGIN.`,
          );
        }
      }

      const historyRows = await client.unsafe<{ created_at: string }[]>(
        `select created_at::text as created_at
           from drizzle.__drizzle_migrations
          order by created_at`,
      );
      const actualHistory = historyRows
        .map((row) => row.created_at)
        .sort();
      const actualHistorySet = new Set(actualHistory);
      const missingHistory = setDifference(
        expectedHistory,
        actualHistorySet,
      );
      const extraHistory = setDifference(actualHistory, new Set(expectedHistory));

      if (
        actualHistory.length !== expectedHistory.length ||
        missingHistory.length > 0 ||
        extraHistory.length > 0
      ) {
        return failure(
          "migration history contains every migration",
          [
            `expected ${expectedHistory.length} applied migration(s), found ${actualHistory.length}.`,
            missingHistory.length > 0
              ? `Missing migration timestamps: ${missingHistory.join(", ")}`
              : "",
            extraHistory.length > 0
              ? `Unexpected migration timestamps: ${extraHistory.join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .join(" "),
        );
      }

      return {
        ok: true,
        tables: expectedTables,
        rlsTables: expectedRls,
        migrations: actualHistory.length,
      };
    } finally {
      await client.end();
    }
  } catch (error) {
    const details = errorDetails(error);

    return failure(currentStep, details.message, details.statement);
  } finally {
    if (admin) {
      if (created) {
        try {
          await admin.unsafe(
            `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
          );
        } catch (dropError) {
          console.error(
            "Warning: could not drop the throwaway database:",
            dropError instanceof Error ? dropError.message : dropError,
          );
        }
      }

      await admin.end();
    }
  }
}

async function main(): Promise<void> {
  const result = await runFreshDatabaseCheck();

  if (result.ok) {
    console.log(
      `PASS: fresh plain-Postgres migration check succeeded (${result.migrations} migrations, ${result.tables.length} tables).`,
    );
    console.log(`Tables verified: ${result.tables.join(", ")}`);
    console.log(`RLS enabled as specified: ${result.rlsTables.join(", ")}`);
    return;
  }

  console.error("FAIL: fresh plain-Postgres migration check failed.");
  console.error(`Step: ${result.failure?.step ?? "unknown"}`);
  console.error(`Message: ${result.failure?.message ?? "unknown error"}`);

  if (result.failure?.statement) {
    console.error(`Failing statement: ${result.failure.statement}`);
  }

  process.exitCode = 1;
}

if (require.main === module) {
  void main();
}
