import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * The integration-test guard (test/helpers/eval-fixtures.ts `assertThrowawayDb`)
 * used by the L06 *.it.test.ts files and `verify:l06 --it`: it must refuse the
 * developer's working database — given as DATABASE_URL or, when verify:l06 has
 * replaced DATABASE_URL with an unreachable one, as DEVDIGEST_WORKING_DATABASE_URL —
 * and the docker-compose port 5432, and accept a Testcontainers URL.
 */

const WORKING = "postgres://devdigest:secret@localhost:5432/devdigest";
const THROWAWAY = "postgres://devdigest:devdigest@localhost:55123/devdigest";

async function loadGuard(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v ?? "");
  return (await import("./helpers/eval-fixtures.js")).assertThrowawayDb;
}

afterEach(() => vi.unstubAllEnvs());

describe("assertThrowawayDb", () => {
  it("refuses the working database given as DATABASE_URL", async () => {
    const guard = await loadGuard({ DATABASE_URL: WORKING, DEVDIGEST_WORKING_DATABASE_URL: "" });
    expect(() => guard(WORKING)).toThrow(/working database/);
  });

  it("refuses the working database passed by verify:l06 while DATABASE_URL is blocked", async () => {
    const guard = await loadGuard({
      DATABASE_URL: "postgres://verify-l06:blocked@127.0.0.1:1/verify_l06_blocked",
      DEVDIGEST_WORKING_DATABASE_URL: "postgres://devdigest:x@db.internal:6543/devdigest",
    });
    expect(() => guard("postgres://other:y@db.internal:6543/devdigest")).toThrow(/working database/);
  });

  it("refuses port 5432 even for another database name", async () => {
    const guard = await loadGuard({ DATABASE_URL: "", DEVDIGEST_WORKING_DATABASE_URL: "" });
    expect(() => guard("postgres://a:b@localhost:5432/other")).toThrow(/5432/);
  });

  it("accepts a Testcontainers database", async () => {
    const guard = await loadGuard({ DATABASE_URL: WORKING, DEVDIGEST_WORKING_DATABASE_URL: WORKING });
    expect(() => guard(THROWAWAY)).not.toThrow();
  });
});
