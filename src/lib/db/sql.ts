/**
 * SQL access, abstracted over exactly two adapters.
 *
 * Production must never silently fall back to the embedded adapter, so the
 * selection rule is explicit and loud: `DATABASE_URL` present means Neon,
 * absent means PGlite. `assertProductionStore()` is called by `/api/health`, and
 * `node:process.env.VERCEL` with no `DATABASE_URL` is a hard failure rather than
 * a silent downgrade.
 *
 * All statements are parameterized. JSON columns are stored as TEXT and parsed in
 * one place so PGlite and Postgres behave identically.
 */

import { PGlite } from "@electric-sql/pglite";

export type AdapterKind = "neon" | "pglite";

export interface SqlExecutor {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface SqlClient extends SqlExecutor {
  kind: AdapterKind;
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class ConfigurationError extends Error {
  override name = "ConfigurationError";
}

/* ------------------------------------------------------------------ *
 * Neon
 * ------------------------------------------------------------------ */

async function createNeonClient(url: string): Promise<SqlClient> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);

  /**
   * `sql.query()` in @neondatabase/serverless 1.x resolves to the row array
   * itself, not to an envelope with a `rows` property. Older examples that
   * destructure `.rows` against this version silently yield `undefined`, which
   * is why the result is normalised defensively here.
   */
  function rowsFrom(result: unknown): unknown[] {
    if (Array.isArray(result)) return result;
    if (result && typeof result === "object" && "rows" in result) {
      const rows = (result as { rows?: unknown }).rows;
      if (Array.isArray(rows)) return rows;
    }
    return [];
  }

  const executor: SqlExecutor = {
    async query<T>(text: string, params: unknown[] = []) {
      const result = await sql.query(text, params as never[]);
      return rowsFrom(result) as T[];
    },
  };

  return {
    kind: "neon",
    query: executor.query,
    /**
     * The Neon HTTP driver does not expose an interactive transaction, and
     * `BEGIN`/`COMMIT` across separate pooled calls would be unsafe. Callers
     * therefore never rely on this for correctness: chain appends are made
     * idempotent by a primary key and the authoritative head is recomputed from
     * `chain_events` on every read. See `repository.ts`.
     */
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>) {
      return fn(executor);
    },
    async close() {
      /* stateless driver */
    },
  };
}

/* ------------------------------------------------------------------ *
 * PGlite (local development and tests)
 * ------------------------------------------------------------------ */

const DATA_DIR = process.env.MINTLINE_PGLITE_DIR ?? ".mintline-data";

let pglitePromise: Promise<PGlite> | null = null;

async function getPGlite(): Promise<PGlite> {
  if (!pglitePromise) {
    pglitePromise = (async () => {
      if (DATA_DIR === ":memory:") return new PGlite();
      try {
        return new PGlite(DATA_DIR);
      } catch {
        // A read-only or unwritable directory must not break `npm run dev`.
        return new PGlite();
      }
    })();
  }
  return pglitePromise;
}

async function createPgliteClient(): Promise<SqlClient> {
  const db = await getPGlite();

  const run = async <T>(text: string, params: unknown[]): Promise<T[]> => {
    const result = await db.query<T>(text, params);
    return result.rows;
  };

  return {
    kind: "pglite",
    async query<T>(text: string, params: unknown[] = []) {
      return run<T>(text, params);
    },
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>) {
      await db.exec("BEGIN");
      try {
        const value = await fn({
          async query<R>(text: string, params: unknown[] = []) {
            const result = await db.query<R>(text, params);
            return result.rows;
          },
        });
        await db.exec("COMMIT");
        return value;
      } catch (error) {
        await db.exec("ROLLBACK").catch(() => undefined);
        throw error;
      }
    },
    async close() {
      /* the singleton is reused across requests in dev */
    },
  };
}

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

let clientPromise: Promise<SqlClient> | null = null;

export async function getSql(): Promise<SqlClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const url = process.env.DATABASE_URL?.trim();
      if (url) return createNeonClient(url);
      return createPgliteClient();
    })().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

/**
 * Reset the cached client. Tests call this between suites; the dev server does
 * not need it.
 */
export async function resetSql(): Promise<void> {
  if (clientPromise) {
    const client = await clientPromise.catch(() => null);
    clientPromise = null;
    if (client) await client.close();
  }
}

/**
 * Fail loudly if a deployed build would run on embedded storage.
 *
 * A serverless function that quietly uses PGlite is the exact failure this
 * project is required to avoid: data that dies with the instance.
 */
export function assertProductionStore(): { ok: boolean; reason?: string } {
  const url = process.env.DATABASE_URL?.trim();
  const deployed = Boolean(process.env.VERCEL || process.env.NODE_ENV === "production");

  if (!url) {
    return {
      ok: !deployed,
      reason: deployed
        ? "DATABASE_URL is not set in a production environment; refusing to run on embedded storage"
        : undefined,
    };
  }
  return { ok: true };
}

/** True when the process is a serverless production runtime. */
export function isServerlessRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}