import { describe, expect, it } from "vitest";
import { runFreshDatabaseCheck } from "../src/scripts/freshDatabaseCheck";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);
const describeWithDatabase = hasTestDatabase ? describe : describe.skip;

describeWithDatabase("plain Postgres fresh-database migration", () => {
  it(
    "applies the role bootstrap and every migration to an empty database",
    async () => {
      const result = await runFreshDatabaseCheck();

      if (!result.ok) {
        throw new Error(
          `Fresh database check failed at "${result.failure?.step}": ${
            result.failure?.message ?? "unknown error"
          }`,
        );
      }

      expect(result.tables.length).toBeGreaterThan(0);
      expect(result.migrations).toBeGreaterThan(0);
      expect(result.rlsTables.length).toBeGreaterThan(0);
    },
    180_000,
  );
});
