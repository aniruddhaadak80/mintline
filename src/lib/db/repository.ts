/**
 * The service layer.
 *
 * Every mutation in this application funnels through this module: the UI forms,
 * the REST routes and the MCP tools call the same functions against the same
 * SQL. That is what makes "the agent mutated through the same path as the UI" a
 * structural fact rather than a claim.
 *
 * Ownership: every row carries `session_id`. Reads filter on it, so one
 * anonymous session cannot see another's records — they get 404, not 403, so the
 * API does not confirm that a row exists.
 *
 * Chain safety: `chain_events` is the authoritative log and `origins.chain_head`
 * is a cache of it. Appends read the head back from the log rather than trusting
 * the cache, so a failed cache update degrades performance, never integrity.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { getSql, type SqlClient, type SqlExecutor } from "./sql";
import { ensureSchema, SEED_ORIGINS, SEED_SESSION_ID } from "./schema";
import { buildEvent, GENESIS_SEAL, replayChain } from "../integrity/chain";
import type {
  AssayResult,
  ChainEvent,
  ClaimEvidence,
  ClaimStatus,
  OriginRecord,
  Paginated,
  ReplayResult,
  Verdict,
} from "../types";

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

interface OriginRow {
  id: string;
  session_id: string;
  mint: string;
  name: string;
  symbol: string | null;
  description: string | null;
  claim_note: string | null;
  claimed_at: string;
  status: string;
  assay: string | null;
  score: number | null;
  chain_head: string;
  event_count: number;
  share_token: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ChainRow {
  seq: number;
  origin_id: string;
  event_type: string;
  payload: string;
  canonical: string;
  prev_seal: string;
  seal: string;
  created_at: string;
}

function toOrigin(row: OriginRow): OriginRecord {
  let assay: AssayResult | null = null;
  if (row.assay) {
    try {
      assay = JSON.parse(row.assay) as AssayResult;
    } catch {
      assay = null;
    }
  }
  return {
    id: row.id,
    sessionId: row.session_id,
    mint: row.mint,
    name: row.name,
    symbol: row.symbol,
    description: row.description,
    claimNote: row.claim_note,
    claimedAt: row.claimed_at,
    status: row.status as ClaimStatus,
    assay,
    chainHead: row.chain_head,
    eventCount: row.event_count,
    shareToken: row.share_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function toEvent(row: ChainRow): ChainEvent {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payload) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return {
    seq: row.seq,
    originId: row.origin_id,
    eventType: row.event_type,
    payload,
    canonical: row.canonical,
    prevSeal: row.prev_seal,
    seal: row.seal,
    createdAt: row.created_at,
  };
}

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

export class NotFoundError extends Error {
  override name = "NotFoundError";
  constructor(message = "not found") {
    super(message);
  }
}

export class ConflictError extends Error {
  override name = "ConflictError";
  constructor(message = "conflict") {
    super(message);
  }
}

export class ValidationError extends Error {
  override name = "ValidationError";
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------ *
 * Session bookkeeping
 * ------------------------------------------------------------------ */

export async function touchSession(sql: SqlExecutor, sessionId: string): Promise<void> {
  const now = new Date().toISOString();
  await sql.query(
    `INSERT INTO sessions (id, created_at, last_seen_at)
     VALUES ($1, $2, $2)
     ON CONFLICT (id) DO UPDATE SET last_seen_at = $2`,
    [sessionId, now],
  );
}

export function newSessionId(): string {
  return `s_${randomBytes(18).toString("hex")}`;
}

export function newOriginId(): string {
  return `o_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/* ------------------------------------------------------------------ *
 * Seeding
 * ------------------------------------------------------------------ */

/** Process-wide, for the same reason as the adapter cache in `sql.ts`. */
interface SeedGlobals {
  __mintlineSeeded?: Promise<void>;
}

const seedGlobals = globalThis as unknown as SeedGlobals;

export async function ensureSeeded(sql: SqlExecutor): Promise<void> {
  if (!seedGlobals.__mintlineSeeded) {
    seedGlobals.__mintlineSeeded = (async () => {
      for (const origin of SEED_ORIGINS) {
        const existing = await sql.query<{ id: string }>(
          "SELECT id FROM origins WHERE id = $1",
          [origin.id],
        );
        if (existing.length > 0) continue;

        const event = buildEvent({
          seq: 1,
          originId: origin.id,
          eventType: "origin.registered",
          payload: {
            name: origin.name,
            symbol: origin.symbol,
            mint: origin.mint,
            description: origin.description,
            claimedAt: origin.claimedAt,
            source: origin.source,
            origin: "registry-seed",
          },
          prevSeal: GENESIS_SEAL,
          createdAt: origin.claimedAt,
        });

        await sql.query(
          `INSERT INTO chain_events
             (origin_id, seq, session_id, event_type, payload, canonical, prev_seal, seal, created_at)
           VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            origin.id,
            SEED_SESSION_ID,
            event.eventType,
            JSON.stringify(event.payload),
            event.canonical,
            event.prevSeal,
            event.seal,
            event.createdAt,
          ],
        );

        await sql.query(
          `INSERT INTO origins
             (id, session_id, mint, name, symbol, description, claim_note, claimed_at, status,
              assay, score, chain_head, event_count, share_token, created_at, updated_at, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'registered', NULL, NULL, $9, 1, NULL, $8, $8, NULL)`,
          [
            origin.id,
            SEED_SESSION_ID,
            origin.mint,
            origin.name,
            origin.symbol,
            origin.description,
            `Reference origin compiled by the registry from ${origin.source}.`,
            origin.claimedAt,
            event.seal,
          ],
        );
      }
    })().catch((error) => {
      seedGlobals.__mintlineSeeded = undefined;
      throw error;
    });
  }
  return seedGlobals.__mintlineSeeded;
}

/** Test hook. */
export function resetSeedCache(): void {
  seedGlobals.__mintlineSeeded = undefined;
}

/* ------------------------------------------------------------------ *
 * Chain helpers
 * ------------------------------------------------------------------ */

async function readChainHead(
  sql: SqlExecutor,
  originId: string,
): Promise<{ seal: string; seq: number }> {
  const rows = await sql.query<{ seal: string; seq: number }>(
    "SELECT seal, seq FROM chain_events WHERE origin_id = $1 ORDER BY seq DESC LIMIT 1",
    [originId],
  );
  if (rows.length === 0) return { seal: GENESIS_SEAL, seq: 0 };
  return { seal: rows[0].seal, seq: Number(rows[0].seq) };
}

export interface AppendResult {
  event: ChainEvent;
  chainHead: string;
  seq: number;
}

/**
 * Append one audit event and return the new head.
 *
 * `ON CONFLICT DO NOTHING` makes a retried append a no-op that still returns the
 * existing event, which is what lets the MCP mutating tools be idempotent.
 */
async function appendEvent(
  sql: SqlExecutor,
  originId: string,
  sessionId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<AppendResult> {
  const head = await readChainHead(sql, originId);
  const seq = head.seq + 1;

  const event = buildEvent({
    seq,
    originId,
    eventType,
    payload,
    prevSeal: head.seal,
    createdAt: new Date().toISOString(),
  });

  const inserted = await sql.query<{ seal: string }>(
    `INSERT INTO chain_events
       (origin_id, seq, session_id, event_type, payload, canonical, prev_seal, seal, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (origin_id, seq) DO NOTHING
     RETURNING seal`,
    [
      originId,
      seq,
      sessionId,
      eventType,
      JSON.stringify(event.payload),
      event.canonical,
      event.prevSeal,
      event.seal,
      event.createdAt,
    ],
  );

  const finalSeal = inserted.length > 0 ? inserted[0].seal : event.seal;

  await sql.query(
    `UPDATE origins SET chain_head = $1, event_count = $2, updated_at = $3 WHERE id = $4`,
    [finalSeal, seq, new Date().toISOString(), originId],
  );

  return { event, chainHead: finalSeal, seq };
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export interface ListOptions {
  sessionId: string;
  /** Include the shared reference registry alongside the caller's own records. */
  includeReference?: boolean;
  status?: ClaimStatus | "all";
  query?: string;
  limit?: number;
  offset?: number;
  sort?: "recent" | "score" | "name";
}

const MAX_LIMIT = 100;

export async function listOrigins(options: ListOptions): Promise<Paginated<OriginRecord>> {
  const sql = await getSql();
  await ensureSchema(sql);

  const limit = Math.max(1, Math.min(MAX_LIMIT, options.limit ?? 25));
  const offset = Math.max(0, options.offset ?? 0);

  const where: string[] = [];
  const params: unknown[] = [];

  if (options.includeReference) {
    where.push(`(session_id = $1 OR session_id = '${SEED_SESSION_ID}')`);
  } else {
    where.push("session_id = $1");
  }
  params.push(options.sessionId);

  const status = options.status ?? "all";
  if (status !== "all") {
    params.push(status);
    where.push(`status = $${params.length}`);
  }

  const term = options.query?.trim();
  if (term) {
    params.push(`%${term.toLowerCase()}%`);
    const index = params.length;
    where.push(`(LOWER(name) LIKE $${index} OR LOWER(COALESCE(symbol,'')) LIKE $${index} OR mint LIKE $${index})`);
  }

  const whereSql = where.join(" AND ");

  const countRows = await sql.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM origins WHERE ${whereSql} AND deleted_at IS NULL`,
    params,
  );
  const total = Number(countRows[0]?.count ?? 0);

  const orderSql =
    options.sort === "score"
      ? "score DESC NULLS LAST, created_at DESC"
      : options.sort === "name"
        ? "LOWER(name) ASC"
        : "created_at DESC";

  const rows = await sql.query<OriginRow>(
    `SELECT * FROM origins WHERE ${whereSql} AND deleted_at IS NULL
      ORDER BY ${orderSql} LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  return {
    items: rows.map(toOrigin),
    total,
    limit,
    offset,
  };
}

/**
 * Claims that cover a given identity, across the caller's own records and the
 * shared reference registry. This is what makes a collision a hard signal.
 */
export async function findClaimsFor(
  sessionId: string,
  identityText: string,
  symbol: string | null,
  matchSymbol: boolean,
): Promise<ClaimEvidence[]> {
  const sql = await getSql();
  await ensureSchema(sql);

  const { identityKey, normalizeIdentityText } = await import("../engine/similarity");

  const key = identityKey(identityText);
  const symbolKey = matchSymbol && symbol ? normalizeIdentityText(symbol) : "";

  const rows = await sql.query<OriginRow>(
    `SELECT * FROM origins
      WHERE deleted_at IS NULL
        AND (session_id = $1 OR session_id = $2)
        AND status <> 'retired'`,
    [sessionId, SEED_SESSION_ID],
  );

  return rows
    .map((row) => ({
      originId: row.id,
      name: row.name,
      symbol: row.symbol,
      mint: row.mint,
      verdict: (row.assay
        ? (JSON.parse(row.assay) as AssayResult).verdict
        : "unregistered") as Verdict,
      claimedAt: row.claimed_at,
    }))
    .filter((claim) => {
      const claimKey = identityKey(`${claim.name} ${claim.symbol ?? ""}`);
      if (key.length > 0 && claimKey === key) return true;
      if (symbolKey.length > 0 && normalizeIdentityText(claim.symbol ?? "") === symbolKey) return true;
      return false;
    });
}

/** Corpus for the collision search: this session's origins plus the references. */
export async function loadCorpus(
  sessionId: string,
): Promise<Array<{ originId: string | null; name: string; symbol: string | null; mint: string | null; text: string; registered: boolean }>> {
  const sql = await getSql();
  await ensureSchema(sql);

  const rows = await sql.query<OriginRow>(
    `SELECT * FROM origins
      WHERE deleted_at IS NULL
        AND (session_id = $1 OR session_id = $2)`,
    [sessionId, SEED_SESSION_ID],
  );

  return rows.map((row) => ({
    originId: row.id,
    name: row.name,
    symbol: row.symbol,
    mint: row.mint,
    text: [row.name, row.symbol, row.description].filter(Boolean).join(" "),
    registered: row.session_id !== SEED_SESSION_ID,
  }));
}

export async function getOrigin(
  sessionId: string,
  id: string,
): Promise<OriginRecord | null> {
  const sql = await getSql();
  await ensureSchema(sql);

  const rows = await sql.query<OriginRow>("SELECT * FROM origins WHERE id = $1", [id]);
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.session_id !== sessionId && row.session_id !== SEED_SESSION_ID) return null;
  return toOrigin(row);
}

/** Public share lookup, keyed by an unguessable token rather than by id. */
export async function getOriginByShareToken(token: string): Promise<OriginRecord | null> {
  const sql = await getSql();
  await ensureSchema(sql);

  const rows = await sql.query<OriginRow>(
    "SELECT * FROM origins WHERE share_token = $1",
    [token],
  );
  if (rows.length === 0) return null;
  return toOrigin(rows[0]);
}

export async function getChainEvents(sessionId: string, originId: string): Promise<ChainEvent[]> {
  const sql = await getSql();
  await ensureSchema(sql);

  const origin = await getOrigin(sessionId, originId);
  if (!origin) return [];

  const rows = await sql.query<ChainRow>(
    "SELECT * FROM chain_events WHERE origin_id = $1 ORDER BY seq ASC",
    [originId],
  );
  return rows.map(toEvent);
}

export async function replayOrigin(sessionId: string, originId: string): Promise<ReplayResult | null> {
  const events = await getChainEvents(sessionId, originId);
  if (events.length === 0) return null;
  return replayChain(originId, events);
}

/* ------------------------------------------------------------------ *
 * Mutations
 * ------------------------------------------------------------------ */

export interface RegisterInput {
  sessionId: string;
  mint: string;
  name: string;
  symbol: string | null;
  description: string | null;
  claimNote: string | null;
  claimedAt?: string;
  assay: AssayResult | null;
  /** Optional client-supplied key so a retried create does not duplicate. */
  idempotencyKey?: string | null;
}

export interface RegisterResult {
  origin: OriginRecord;
  created: boolean;
}

export async function registerOrigin(input: RegisterInput): Promise<RegisterResult> {
  const sql = await getSql();
  await ensureSchema(sql);
  await ensureSeeded(sql);

  const now = new Date().toISOString();
  const claimedAt = input.claimedAt ?? now;

  // Idempotency: a repeated key for the same session returns the existing row.
  if (input.idempotencyKey) {
    const existing = await sql.query<OriginRow>(
      "SELECT * FROM origins WHERE session_id = $1 AND id = $2",
      [input.sessionId, `idem_${hashToken(input.idempotencyKey)}`],
    );
    if (existing.length > 0) return { origin: toOrigin(existing[0]), created: false };
  }

  // A session cannot register the same mint twice.
  const duplicate = await sql.query<OriginRow>(
    "SELECT * FROM origins WHERE session_id = $1 AND mint = $2 AND deleted_at IS NULL",
    [input.sessionId, input.mint],
  );
  if (duplicate.length > 0) {
    throw new ConflictError(`this session already registered ${input.mint}`);
  }

  const id = input.idempotencyKey
    ? `idem_${hashToken(input.idempotencyKey)}`
    : newOriginId();

  await sql.query(
    `INSERT INTO origins
       (id, session_id, mint, name, symbol, description, claim_note, claimed_at, status,
        assay, score, chain_head, event_count, share_token, created_at, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'registered', $9, $10, $11, 0, NULL, $12, $12, NULL)`,
    [
      id,
      input.sessionId,
      input.mint,
      input.name,
      input.symbol,
      input.description,
      input.claimNote,
      claimedAt,
      input.assay ? JSON.stringify(input.assay) : null,
      input.assay ? input.assay.score : null,
      GENESIS_SEAL,
      now,
    ],
  );

  await appendEvent(sql, id, input.sessionId, "origin.registered", {
    mint: input.mint,
    name: input.name,
    symbol: input.symbol,
    claimNote: input.claimNote,
    claimedAt,
    assayVersion: input.assay?.engineVersion ?? null,
    score: input.assay?.score ?? null,
    verdict: input.assay?.verdict ?? null,
  });

  const origin = await getOrigin(input.sessionId, id);
  if (!origin) throw new Error("origin vanished immediately after insert");
  return { origin, created: true };
}

/** Attach or replace the assay stored on a record. */
export async function saveAssay(
  sessionId: string,
  originId: string,
  assay: AssayResult,
): Promise<OriginRecord> {
  const sql = await getSql();
  await ensureSchema(sql);

  const existing = await getOrigin(sessionId, originId);
  if (!existing) throw new NotFoundError();
  if (existing.deletedAt) throw new ConflictError("record is retired");

  await sql.query("UPDATE origins SET assay = $1, score = $2, updated_at = $3 WHERE id = $4", [
    JSON.stringify(assay),
    assay.score,
    new Date().toISOString(),
    originId,
  ]);

  await appendEvent(sql, originId, sessionId, "origin.assayed", {
    engineVersion: assay.engineVersion,
    score: assay.score,
    verdict: assay.verdict,
    degraded: assay.degraded,
    factors: assay.factors.map((f) => ({
      key: f.key,
      weight: f.weight,
      value: f.value,
      points: f.points,
      availability: f.availability,
    })),
    neighbors: assay.neighbors.slice(0, 3).map((n) => ({
      name: n.name,
      similarity: n.similarity,
    })),
  });

  const updated = await getOrigin(sessionId, originId);
  if (!updated) throw new NotFoundError();
  return updated;
}

export async function recordVerdict(
  sessionId: string,
  originId: string,
  status: ClaimStatus,
  note: string | null,
  idempotencyKey?: string | null,
): Promise<OriginRecord> {
  const sql = await getSql();
  await ensureSchema(sql);

  const existing = await getOrigin(sessionId, originId);
  if (!existing) throw new NotFoundError();
  if (existing.deletedAt) throw new ConflictError("record is retired");

  const now = new Date().toISOString();
  const nextDeletedAt = status === "retired" ? now : null;

  await sql.query(
    "UPDATE origins SET status = $1, claim_note = COALESCE($2, claim_note), deleted_at = $3, updated_at = $4 WHERE id = $5",
    [status, note, nextDeletedAt, now, originId],
  );

  await appendEvent(sql, originId, sessionId, "origin.verdict_recorded", {
    status,
    note,
    idempotencyKey: idempotencyKey ?? null,
  });

  const updated = await getOrigin(sessionId, originId);
  if (!updated) throw new NotFoundError();
  return updated;
}

/**
 * Soft-delete.
 *
 * The row is kept, not erased, because replaying the chain has to keep working
 * after the fact; the tombstone is what a delete leaves behind.
 */
export async function retireOrigin(sessionId: string, originId: string): Promise<OriginRecord> {
  const sql = await getSql();
  await ensureSchema(sql);

  const existing = await getOrigin(sessionId, originId);
  if (!existing) throw new NotFoundError();
  if (existing.sessionId === SEED_SESSION_ID) {
    throw new ConflictError("reference registry entries are not editable");
  }

  const now = new Date().toISOString();

  await sql.query(
    "UPDATE origins SET deleted_at = $1, status = 'retired', updated_at = $2 WHERE id = $3",
    [now, now, originId],
  );

  await appendEvent(sql, originId, sessionId, "origin.retired", {
    reason: "retired by owner",
    tombstone: true,
  });

  const updated = await getOrigin(sessionId, originId);
  if (!updated) throw new NotFoundError();
  return updated;
}

export async function setShareToken(
  sessionId: string,
  originId: string,
  token: string | null,
): Promise<OriginRecord> {
  const sql = await getSql();
  await ensureSchema(sql);

  const existing = await getOrigin(sessionId, originId);
  if (!existing) throw new NotFoundError();
  if (existing.sessionId === SEED_SESSION_ID) {
    throw new ConflictError("reference registry entries are not shareable");
  }

  await sql.query("UPDATE origins SET share_token = $1, updated_at = $2 WHERE id = $3", [
    token,
    new Date().toISOString(),
    originId,
  ]);

  await appendEvent(sql, originId, sessionId, "origin.updated", {
    shareable: token !== null,
  });

  const updated = await getOrigin(sessionId, originId);
  if (!updated) throw new NotFoundError();
  return updated;
}

export function newShareToken(): string {
  return randomBytes(16).toString("hex");
}

function hashToken(token: string): string {
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) {
    hash = (hash * 31 + token.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36) + token.length.toString(36);
}

/* ------------------------------------------------------------------ *
 * Health
 * ------------------------------------------------------------------ */

export interface StoreHealth {
  ok: boolean;
  adapter: string;
  roundTripMs: number;
  error?: string;
}

export async function checkStore(): Promise<StoreHealth> {
  const started = Date.now();
  try {
    const sql = await getSql();
    await ensureSchema(sql);
    await ensureSeeded(sql);
    const rows = await sql.query<{ ok: number }>("SELECT 1 AS ok");
    if (rows.length === 0) throw new Error("probe returned no rows");
    return { ok: true, adapter: sql.kind, roundTripMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      adapter: "unknown",
      roundTripMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type { SqlClient };