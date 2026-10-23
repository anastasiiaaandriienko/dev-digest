import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, type DbHandle } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

/**
 * Testcontainers helper: spin a Postgres + pgvector container, run migrations,
 * return a Drizzle client. Uses the same `pgvector/pgvector:pg16` image as
 * docker-compose so the `vector` extension is available.
 *
 * Integration tests gate on `dockerAvailable()` and skip cleanly when Docker is
 * not reachable (CI/sandbox without a Docker daemon).
 *
 * Opt-in local mode (no Docker): DEVDIGEST_IT_PG_ADMIN_URL = an existing
 * Postgres + pgvector server, given by its `postgres` maintenance database
 * (used only for CREATE / DROP DATABASE). Each `startPg()` then creates its own
 * throwaway `devdigest_it_<pid>_<hex>` database, migrates it, and `stop()` drops
 * exactly that database. `dockerAvailable()` answers true so the suites run.
 * Tests that refuse port 5432 (eval suites' `assertThrowawayDb`) still refuse.
 */
export interface PgFixture {
  /** Absent in the local mode (no container). */
  container?: StartedPostgreSqlContainer;
  handle: DbHandle;
  url: string;
  stop: () => Promise<void>;
}

const LOCAL_ADMIN_URL = process.env.DEVDIGEST_IT_PG_ADMIN_URL || undefined;
const TEMP_DB_RE = /^devdigest_it_\d+_[0-9a-f]{12}$/;
const PROTECTED_DBS = new Set(['devdigest', 'devdigest_export_ci', 'devdigest_multi_agent', 'postgres', 'template0', 'template1']);
/** Throwaway databases created by THIS process and not dropped yet. */
const createdHere = new Set<string>();

let dockerCache: boolean | undefined;

/** Cheap check: can we reach a Docker daemon? (Always true in the local mode.) */
export async function dockerAvailable(): Promise<boolean> {
  if (LOCAL_ADMIN_URL) return true;
  if (dockerCache !== undefined) return dockerCache;
  try {
    const { execSync } = await import('node:child_process');
    execSync('docker info', { stdio: 'ignore', timeout: 5000 });
    dockerCache = true;
  } catch {
    dockerCache = false;
  }
  return dockerCache;
}

export async function startPg(): Promise<PgFixture> {
  if (LOCAL_ADMIN_URL) return startLocalPg(LOCAL_ADMIN_URL);
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('devdigest')
    .withUsername('devdigest')
    .withPassword('devdigest')
    .start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  const handle = createDb(url, { max: 5 });
  return {
    container,
    handle,
    url,
    stop: async () => {
      await handle.close();
      await container.stop();
    },
  };
}

function adminUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.pathname !== '/postgres') {
    throw new Error('DEVDIGEST_IT_PG_ADMIN_URL must name the "postgres" maintenance database');
  }
  return u;
}

async function withAdmin<T>(raw: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(adminUrl(raw).toString(), { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Drop a throwaway database — only one this process created, by exact name. */
async function dropTempDb(raw: string, name: string): Promise<void> {
  if (!TEMP_DB_RE.test(name) || PROTECTED_DBS.has(name) || !createdHere.has(name)) {
    throw new Error(`refusing to drop database "${name}": not a throwaway database of this run`);
  }
  await withAdmin(raw, (sql) => sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
  createdHere.delete(name);
}

async function startLocalPg(raw: string): Promise<PgFixture> {
  const name = `devdigest_it_${process.pid}_${randomBytes(6).toString('hex')}`;
  if (!TEMP_DB_RE.test(name) || PROTECTED_DBS.has(name)) throw new Error(`bad throwaway database name "${name}"`);
  await withAdmin(raw, (sql) => sql.unsafe(`CREATE DATABASE "${name}"`));
  createdHere.add(name);
  const u = adminUrl(raw);
  u.pathname = `/${name}`;
  const url = u.toString();
  try {
    await runMigrations(url);
  } catch (err) {
    await dropTempDb(raw, name);
    throw err;
  }
  const handle = createDb(url, { max: 5 });
  return {
    handle,
    url,
    stop: async () => {
      try {
        await handle.close();
      } finally {
        await dropTempDb(raw, name);
      }
    },
  };
}

// Safety net: a suite that never reached its afterAll (or whose stop() threw)
// still has its database dropped when the worker drains.
if (LOCAL_ADMIN_URL) {
  process.once('beforeExit', async () => {
    for (const name of [...createdHere]) {
      try {
        await dropTempDb(LOCAL_ADMIN_URL, name);
      } catch (err) {
        console.error(`could not drop throwaway database ${name}: ${(err as Error).message}`);
      }
    }
  });
}
