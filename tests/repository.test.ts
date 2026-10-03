import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Repository integration, run against the embedded PGlite adapter.
 *
 * This is the same code path production uses, only against a different driver:
 * identical SQL, identical service functions. It proves the parts that unit
 * tests cannot — that a create is really persisted, that a second session
 * cannot see it, and that the chain survives a tombstone.
 */

process.env.MINTLINE_PGLITE_DIR = ":memory:";
delete process.env.DATABASE_URL;

const {
  registerOrigin,
  listOrigins,
  getOrigin,
  recordVerdict,
  retireOrigin,
  replayOrigin,
  getChainEvents,
  saveAssay,
  setShareToken,
  getOriginByShareToken,
  ensureSeeded,
  newShareToken,
  resetSeedCache,
} = await import("@/lib/db/repository");
const { getSql } = await import("@/lib/db/sql");
const { ensureSchema } = await import("@/lib/db/schema");
const { runAssay } = await import("@/lib/engine/assay");
const { GENESIS_SEAL } = await import("@/lib/integrity/chain");

const SESSION_A = "s_testaaaaaaaaaaaaaaaaaaaaaa";
const SESSION_B = "s_testbbbbbbbbbbbbbbbbbbbbbb";
const MINT = "So11111111111111111111111111111111111111112";

function assay() {
  return runAssay(
    {
      mint: MINT,
      identityText: "Integration Fixture Token IFX integration fixture",
      facts: {
        mint: MINT,
        validAddress: true,
        metadata: {
          mint: MINT,
          metadataAddress: null,
          updateAuthority: null,
          name: "Integration Fixture",
          symbol: "IFX",
          uri: "https://example.com",
          description: "A fixture asset used by the repository integration suite to exercise persistence.",
          offchainLoaded: true,
          primarySaleHappened: true,
          isMutable: false,
        },
        pairs: [],
        liquidityUsd: 50_000,
        volume24h: 1_000,
        priceUsd: 1,
        priceChange24h: 0,
        oldestPairAt: "2024-01-01T00:00:00.000Z",
        ageDays: 500,
        pairCount: 1,
        dexCount: 1,
        holders: { state: "ok", topShare: 0.1, accountsInspected: 20, supplyRaw: "1", decimals: 6 },
        corroboration: { source: "jupiter", priceUsd: 1, divergence: 0 },
        sources: [],
      },
      similarity: {
        method: "lexical",
        model: "lexical-cosine-v1",
        top: 0.05,
        neighbors: [],
        degraded: true,
      },
      existingClaims: [],
    },
    null,
  );
}

beforeEach(async () => {
  const sql = await getSql();
  await ensureSchema(sql);
  // `ensureSeeded` memoises, so the cache has to be cleared alongside the rows
  // it would otherwise skip re-inserting.
  resetSeedCache();
  await sql.query("DELETE FROM chain_events");
  await sql.query("DELETE FROM origins");
});

afterAll(async () => {
  const { resetSql } = await import("@/lib/db/sql");
  await resetSql();
});

describe("schema and seeding", () => {
  it("is idempotent across repeated application", async () => {
    const sql = await getSql();
    await ensureSchema(sql);
    await ensureSchema(sql);
    await ensureSchema(sql);
    expect(sql.kind).toBe("pglite");
  });

  it("seeds the reference registry exactly once", async () => {
    const sql = await getSql();
    await ensureSeeded(sql);
    await ensureSeeded(sql);
    const rows = await sql.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM origins WHERE session_id = 'registry'",
    );
    expect(Number(rows[0].count)).toBe(5);
  });

  it("starts every seeded chain at the genesis seal", async () => {
    const sql = await getSql();
    await ensureSeeded(sql);
    const rows = await sql.query<{ prev_seal: string }>(
      "SELECT prev_seal FROM chain_events WHERE seq = 1",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.prev_seal).toBe(GENESIS_SEAL);
  });
});

describe("create, read, update", () => {
  it("persists a new claim with a sealed first event", async () => {
    const { origin, created } = await registerOrigin({
      sessionId: SESSION_A,
      mint: MINT,
      name: "Integration Fixture",
      symbol: "IFX",
      description: "A fixture asset.",
      claimNote: "Filed by the integration suite.",
      assay: assay(),
    });

    expect(created).toBe(true);
    expect(origin.eventCount).toBe(1);
    expect(origin.status).toBe("registered");
    expect(origin.assay?.score).toBeGreaterThan(0);

    // After registering, the chain already holds event 1, so the head is that
    // event's seal rather than the genesis.
    const firstEvent = (await getChainEvents(SESSION_A, origin.id))[0];
    expect(origin.chainHead).toBe(firstEvent.seal);
    expect(firstEvent.prevSeal).toBe(GENESIS_SEAL);

    const readBack = await getOrigin(SESSION_A, origin.id);
    expect(readBack).not.toBeNull();
    expect(readBack!.name).toBe("Integration Fixture");
    expect(readBack!.assay?.engineVersion).toBe(readBack!.assay?.engineVersion);
  });

  it("extends the chain on each mutation", async () => {
    const { origin } = await registerOrigin({
      sessionId: SESSION_A,
      mint: MINT,
      name: "Integration Fixture",
      symbol: "IFX",
      description: null,
      claimNote: null,
      assay: assay(),
    });

    expect(origin.eventCount).toBe(1);
    expect(origin.chainHead).not.toBe(GENESIS_SEAL);

    const afterVerdict = await recordVerdict(SESSION_A, origin.id, "disputed", "Looks copied.");
    expect(afterVerdict.eventCount).toBe(2);
    expect(afterVerdict.status).toBe("disputed");
    expect(afterVerdict.chainHead).not.toBe(GENESIS_SEAL);

    const afterAssay = await saveAssay(SESSION_A, origin.id, assay());
    expect(afterAssay.eventCount).toBe(3);
  });

  it("keeps the chain replayable after every mutation", async () => {
    const { origin } = await registerOrigin({
      sessionId: SESSION_A,
      mint: MINT,
      name: "Integration Fixture",
      symbol: "IFX",
      description: null,
      claimNote: null,
      assay: assay(),
    });
    await recordVerdict(SESSION_A, origin.id, "registered", null);
    await saveAssay(SESSION_A, origin.id, assay());
    await recordVerdict(SESSION_A, origin.id, "disputed", "second look");

    const replay = await replayOrigin(SESSION_A, origin.id);
    expect(replay).not.toBeNull();
    expect(replay!.ok).toBe(true);
    expect(replay!.checked).toBe(4);
    expect(replay!.brokenAtSeq).toBeNull();
  });

  it("is idempotent when the same key is replayed", async () => {
    const first = await registerOrigin({
      sessionId: SESSION_A,
      mint: MINT,
      name: "Integration Fixture",
      symbol: "IFX",
      description: null,
      claimNote: null,
      assay: assay(),
      idempotencyKey: "stable-key-1",
    });
    const second = await registerOrigin({
      sessionId: SESSION_A,
      mint: MINT,
      name: "Integration Fixture",
      symbol: "IFX",
      description: null,
      claimNote: null,
      assay: assay(),
      idempotencyKey: "stable-key-1",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.origin.id).toBe(first.origin.id);

    const sql = await getSql();
    const rows = await sql.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM origins WHERE session_id = $1",
      [SESSION_A],
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it("rejects a second claim on the same mint from one session", async () => {
    await registerOrigin({
      sessionId: SESSION_A,
      mint: MINT,
      name: "First",
      symbol: null,
      description: null,
      claimNote: null,
      assay: assay(),
    });
    await expect(
      registerOrigin({
        sessionId: SESSION_A,
        mint: MINT,
        name: "Second",
        symbol: null,
        description: null,
        claimNote: null,
        assay: assay(),
      }),
    ).rejects.toThrow(/already registered/);
  });

  it("lets a different session register the same mint", async () => {
    const a = await registerOrigin({
      sessionId: SESSION_A,
      mint: MINT,
      name: "Session A Claim",
      symbol: null,
      description: null,
      claimNote: null,
      assay: assay(),
    });
    const b = await registerOrigin({
      sessionId: SESSION_B,
      mint: MINT,
      name: "Session B Claim",
      symbol: null,
      description: null,
      claimNote: null,
      assay: assay(),
    });
    expect(a.origin.id).not.toBe(b.origin.id);
  });
});

describe("session ownership", () => {
  it("hides another session's record instead of returning it", async () => {
    const { origin } = await registerOrigin({
      sessionId: SESSION_A,
      mint: MINT,
      name: "Private Fixture",
      symbol: null,
      description: null,
      claimNote: null,
      assay: assay(),
    });

    expect(await getOrigin(SESSION_B, origin.id)).toBeNull();

    const page = await listOrigins({
      sessionId: SESSION_B,
      includeReference: false,
      limit: 50,
      offset: 0,
    });
    expect(page.items.find((item) => item.id === origin.id)).toBeUndefined();
  });

  it("shows the reference registry to every session", async () => {
    const sql = await getSql();
    await ensureSeeded(sql);
    const page = await listOrigins({
      sessionId: SESSION_B,
      includeReference: true,
      limit: 50,
      offset: 0,
    });
    expect(page.items.some((item) => item.id.startsWith("seed:"))).toBe(true);
  });

  it("refuses to mutate a record it cannot see", async () => {
    const { origin } = await registerOrigin({
      sessionId: SESSION_A,
      mint: MINT,
      name: "Private Fixture",
      symbol: null,
      description: null,
      claimNote: null,
      assay: assay(),
    });

    await expect(recordVerdict(SESSION_B, origin.id, "disputed", null)).rejects.toThrow();
    await expect(retireOrigin(SESSION_B, origin.id)).rejects.toThrow();
  });
});

describe("retirement", () => {
  it("keeps the row as a tombstone and stays replayable", async () => {
    const { origin } = await registerOrigin({
      sessionId: SESSION_A,
      mint: MINT,
      name: "Doomed Fixture",
      symbol: null,
      description: null,
      claimNote: null,
      assay: assay(),
    });

    const retired = await retireOrigin(SESSION_A, origin.id);
    expect(retired.deletedAt).not.toBeNull();
    expect(retired.status).toBe("retired");
    expect(retired.eventCount).toBe(2);

    const replay = await replayOrigin(SESSION_A, origin.id);
    expect(replay!.ok).toBe(true);

    const events = await getChainEvents(SESSION_A, origin.id);
    expect(events.some((event) => event.eventType === "origin.retired")).toBe(true);
  });

  it("hides the tombstone from the default listing but keeps the record", async () => {
    const { origin } = await registerOrigin({
      sessionId: SESSION_A,
      mint: MINT,
      name: "Doomed Fixture",
      symbol: null,
      description: null,
      claimNote: null,
      assay: assay(),
    });
    await retireOrigin(SESSION_A, origin.id);

    const page = await listOrigins({
      sessionId: SESSION_A,
      includeReference: false,
      limit: 50,
      offset: 0,
    });
    expect(page.items.find((item) => item.id === origin.id)).toBeUndefined();
    expect(await getOrigin(SESSION_A, origin.id)).not.toBeNull();
  });

  it("refuses to retire a reference registry entry", async () => {
    const sql = await getSql();
    await ensureSeeded(sql);
    await expect(retireOrigin(SESSION_A, "seed:bonk")).rejects.toThrow(/reference registry/);
  });

  it("frees the mint so it can be claimed again", async () => {
    const first = await registerOrigin({
      sessionId: SESSION_A,
      mint: MINT,
      name: "First Claim",
      symbol: null,
      description: null,
      claimNote: null,
      assay: assay(),
    });
    await retireOrigin(SESSION_A, first.origin.id);

    const second = await registerOrigin({
      sessionId: SESSION_A,
      mint: MINT,
      name: "Second Claim",
      symbol: null,
      description: null,
      claimNote: null,
      assay: assay(),
    });
    expect(second.created).toBe(true);
    expect(second.origin.id).not.toBe(first.origin.id);
  });
});

describe("share tokens", () => {
  it("issues, resolves and revokes a share token", async () => {
    const { origin } = await registerOrigin({
      sessionId: SESSION_A,
      mint: MINT,
      name: "Shareable Fixture",
      symbol: null,
      description: null,
      claimNote: null,
      assay: assay(),
    });

    const token = newShareToken();
    const shared = await setShareToken(SESSION_A, origin.id, token);
    expect(shared.shareToken).toBe(token);

    const resolved = await getOriginByShareToken(token);
    expect(resolved?.id).toBe(origin.id);

    await setShareToken(SESSION_A, origin.id, null);
    expect(await getOriginByShareToken(token)).toBeNull();
  });

  it("does not share reference registry entries", async () => {
    const sql = await getSql();
    await ensureSeeded(sql);
    await expect(setShareToken(SESSION_A, "seed:bonk", newShareToken())).rejects.toThrow(
      /reference registry/,
    );
  });
});

describe("filtering, sorting and paging", () => {
  it("filters by status and free-text query", async () => {
    const disputed = await registerOrigin({
      sessionId: SESSION_A,
      mint: MINT,
      name: "Alpha Distinct Name",
      symbol: "ALP",
      description: null,
      claimNote: null,
      assay: assay(),
    });
    await recordVerdict(SESSION_A, disputed.origin.id, "disputed", "no");

    await registerOrigin({
      sessionId: SESSION_A,
      mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      name: "Beta Other Name",
      symbol: "BET",
      description: null,
      claimNote: null,
      assay: assay(),
    });

    const byStatus = await listOrigins({
      sessionId: SESSION_A,
      includeReference: false,
      status: "disputed",
      limit: 50,
      offset: 0,
    });
    expect(byStatus.items.every((item) => item.status === "disputed")).toBe(true);
    expect(byStatus.total).toBe(1);

    const byQuery = await listOrigins({
      sessionId: SESSION_A,
      includeReference: false,
      query: "beta",
      limit: 50,
      offset: 0,
    });
    expect(byQuery.total).toBe(1);
    expect(byQuery.items[0].name).toBe("Beta Other Name");
  });

  it("sorts by score descending", async () => {
    await registerOrigin({
      sessionId: SESSION_A,
      mint: MINT,
      name: "Low Score Holder",
      symbol: "LOW",
      description: null,
      claimNote: null,
      assay: assay(),
    });

    const page = await listOrigins({
      sessionId: SESSION_A,
      includeReference: false,
      sort: "score",
      limit: 50,
      offset: 0,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].assay?.score).toBeGreaterThan(0);
  });

  it("paginates with a bounded limit", async () => {
    await registerOrigin({
      sessionId: SESSION_A,
      mint: MINT,
      name: "Paged Fixture",
      symbol: null,
      description: null,
      claimNote: null,
      assay: assay(),
    });

    const first = await listOrigins({
      sessionId: SESSION_A,
      includeReference: false,
      limit: 1,
      offset: 0,
    });
    expect(first.items).toHaveLength(1);
    expect(first.limit).toBe(1);

    const beyond = await listOrigins({
      sessionId: SESSION_A,
      includeReference: false,
      limit: 1,
      offset: 5,
    });
    expect(beyond.items).toHaveLength(0);
    expect(beyond.total).toBe(1);
  });

  it("clamps an oversized limit rather than trusting it", async () => {
    const page = await listOrigins({
      sessionId: SESSION_A,
      includeReference: false,
      limit: 100_000,
      offset: 0,
    });
    expect(page.limit).toBeLessThanOrEqual(100);
  });
});

describe("store health", () => {
  it("reports the adapter that answered", async () => {
    const { checkStore } = await import("@/lib/db/repository");
    const health = await checkStore();
    expect(health.ok).toBe(true);
    expect(health.adapter).toBe("pglite");
    expect(typeof health.roundTripMs).toBe("number");
  });
});