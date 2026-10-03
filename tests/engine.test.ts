import { describe, expect, it } from "vitest";
import { classify, ENGINE_WEIGHTS, runAssay, VERDICT_BANDS } from "@/lib/engine/assay";
import { ENGINE_VERSION, type AssayInput, type MintFacts } from "@/lib/types";

function facts(overrides: Partial<MintFacts> = {}): MintFacts {
  return {
    mint: "So11111111111111111111111111111111111111112",
    validAddress: true,
    metadata: {
      mint: "So11111111111111111111111111111111111111112",
      metadataAddress: "6dM4TqWyWJsbx7obrdLcviBkTafdD5E8av61zfU6jq57X",
      updateAuthority: "11111111111111111111111111111111",
      name: "Wrapped SOL",
      symbol: "WSOL",
      uri: "https://www.solana.com",
      description:
        "Wrapped SOL is the Solana program-controlled token representation of native SOL, used as the quote asset across Solana liquidity venues.",
      offchainLoaded: true,
      primarySaleHappened: true,
      isMutable: false,
    },
    pairs: [],
    liquidityUsd: 120_000,
    volume24h: 8_000_000,
    priceUsd: 142,
    priceChange24h: 0.01,
    oldestPairAt: "2024-01-01T00:00:00.000Z",
    ageDays: 400,
    pairCount: 4,
    dexCount: 3,
    holders: { state: "ok", topShare: 0.12, accountsInspected: 20, supplyRaw: "1", decimals: 9 },
    corroboration: { source: "jupiter", priceUsd: 142.01, divergence: 0.00007 },
    sources: [],
    ...overrides,
  };
}

function input(overrides: Partial<AssayInput> = {}): AssayInput {
  return {
    mint: "So11111111111111111111111111111111111111112",
    identityText: "Wrapped SOL WSOL wrapped solana quote asset",
    facts: facts(),
    similarity: {
      method: "lexical",
      model: "lexical-cosine-v1",
      top: 0.1,
      neighbors: [],
      degraded: true,
    },
    existingClaims: [],
    ...overrides,
  };
}

describe("weights", () => {
  it("sum to exactly 1", () => {
    const total = Object.values(ENGINE_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("gives every factor a positive weight", () => {
    for (const weight of Object.values(ENGINE_WEIGHTS)) {
      expect(weight).toBeGreaterThan(0);
    }
  });

  it("weights collision detection highest", () => {
    const max = Math.max(...Object.values(ENGINE_WEIGHTS));
    expect(ENGINE_WEIGHTS.metadata_collision).toBe(max);
  });
});

describe("verdict bands", () => {
  it("tile 0..100 with no gaps or overlaps", () => {
    const sorted = [...VERDICT_BANDS].sort((a, b) => a.min - b.min);
    expect(sorted[0].min).toBe(0);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i].min).toBe(sorted[i - 1].max + 1);
    }
    expect(sorted[sorted.length - 1].max).toBe(100);
  });

  it("classifies boundary values into exactly one band", () => {
    expect(classify(0).verdict).toBe("impersonation_likely");
    expect(classify(34).verdict).toBe("impersonation_likely");
    expect(classify(35).verdict).toBe("collision_suspected");
    expect(classify(55).verdict).toBe("unregistered");
    expect(classify(75).verdict).toBe("attested_origin");
    expect(classify(100).verdict).toBe("attested_origin");
  });

  it("clamps out-of-range scores instead of returning undefined", () => {
    expect(classify(-40).verdict).toBe("impersonation_likely");
    expect(classify(1000).verdict).toBe("attested_origin");
  });
});

describe("runAssay", () => {
  it("stamps the engine version on every result", () => {
    expect(runAssay(input()).engineVersion).toBe(ENGINE_VERSION);
  });

  it("returns a score inside 0..100", () => {
    const result = runAssay(input());
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("is deterministic across repeated runs", () => {
    const first = runAssay(input());
    const second = runAssay(input());
    expect(second.score).toBe(first.score);
    expect(second.verdict).toBe(first.verdict);
    expect(second.factors.map((f) => f.points)).toEqual(first.factors.map((f) => f.points));
  });

  it("itemizes every factor with evidence and a weight", () => {
    const result = runAssay(input());
    expect(result.factors).toHaveLength(6);
    for (const factor of result.factors) {
      expect(factor.weight).toBeGreaterThan(0);
      expect(factor.evidence.length).toBeGreaterThan(0);
      expect(factor.rationale.length).toBeGreaterThan(0);
      expect(factor.value).toBeGreaterThanOrEqual(0);
      expect(factor.value).toBeLessThanOrEqual(1);
    }
  });

  it("sums factor points to the reported score", () => {
    const result = runAssay(input());
    const sum = result.factors.reduce((total, factor) => total + factor.points, 0);
    expect(sum).toBeCloseTo(result.score, 1);
  });

  it("penalises an exact collision hardest", () => {
    const clean = runAssay(input());
    const collided = runAssay(
      input({
        existingClaims: [
          {
            originId: "seed:bonk",
            name: "Wrapped SOL",
            symbol: "WSOL",
            mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
            verdict: "attested_origin",
            claimedAt: "2020-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    expect(collided.score).toBeLessThan(clean.score);
    expect(collided.verdict).not.toBe("attested_origin");
  });

  it("penalises a high semantic similarity", () => {
    const far = runAssay(
      input({
        similarity: {
          method: "lexical",
          model: "lexical-cosine-v1",
          top: 0.1,
          neighbors: [
            { originId: "a", name: "Other", symbol: null, mint: null, similarity: 0.1, sharedTerms: [], registered: true },
          ],
          degraded: true,
        },
      }),
    );
    const near = runAssay(
      input({
        similarity: {
          method: "neural",
          model: "minilm",
          top: 0.93,
          neighbors: [
            { originId: "a", name: "Other", symbol: null, mint: null, similarity: 0.93, sharedTerms: ["sol"], registered: true },
          ],
          degraded: false,
        },
      }),
    );
    expect(near.score).toBeLessThan(far.score);
  });

  it("flags degradation when a factor cannot be measured", () => {
    const degraded = runAssay(
      input({
        facts: facts({
          holders: {
            state: "unavailable",
            topShare: null,
            accountsInspected: 0,
            supplyRaw: null,
            decimals: null,
            reason: "rate limited",
          },
          ageDays: null,
          oldestPairAt: null,
        }),
      }),
    );
    expect(degraded.degraded).toBe(true);
    const concentration = degraded.factors.find((f) => f.key === "holder_concentration");
    expect(concentration?.availability).toBe("unavailable");
    expect(concentration?.points).toBe(0);
  });

  it("does not rebalance weights around a gap", () => {
    const full = runAssay(input());
    const partial = runAssay(
      input({
        facts: facts({
          holders: {
            state: "unavailable",
            topShare: null,
            accountsInspected: 0,
            supplyRaw: null,
            decimals: null,
            reason: "rate limited",
          },
        }),
      }),
    );
    // The other factors keep their published points; only the missing one drops.
    const others = (result: typeof full) =>
      result.factors.filter((f) => f.availability === "measured").map((f) => f.points);
    for (const point of others(partial)) {
      expect(others(full)).toContain(point);
    }
  });

  it("handles an empty corpus without inventing a collision", () => {
    const result = runAssay(
      input({
        similarity: { method: "lexical", model: "lexical-cosine-v1", top: 0, neighbors: [], degraded: true },
      }),
    );
    expect(result.neighbors).toHaveLength(0);
    const collision = result.factors.find((f) => f.key === "metadata_collision");
    expect(collision?.availability).toBe("unavailable");
    expect(collision?.evidence).toMatch(/untestable/);
  });

  it("handles empty identity text", () => {
    const result = runAssay(input({ identityText: "" }));
    const collision = result.factors.find((f) => f.key === "metadata_collision");
    expect(collision?.availability).toBe("unavailable");
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("handles malformed numeric facts without producing NaN", () => {
    const result = runAssay(
      input({
        facts: facts({
          liquidityUsd: Number.NaN,
          volume24h: Number.NaN,
          ageDays: Number.NaN,
          holders: { state: "ok", topShare: Number.NaN, accountsInspected: 20, supplyRaw: "1", decimals: 9 },
        }),
      }),
    );
    expect(Number.isNaN(result.score)).toBe(false);
    for (const factor of result.factors) {
      expect(Number.isNaN(factor.value)).toBe(false);
      expect(Number.isNaN(factor.points)).toBe(false);
    }
  });

  it("scores a deep, aged, well-documented asset above a fresh thin shell", () => {
    const healthy = runAssay(input());

    const shell = runAssay(
      input({
        identityText: "New Coin",
        facts: facts({
          liquidityUsd: 40,
          volume24h: 100,
          ageDays: 0.02,
          pairCount: 1,
          dexCount: 1,
          holders: { state: "ok", topShare: 0.94, accountsInspected: 20, supplyRaw: "1", decimals: 6 },
          metadata: {
            ...facts().metadata!,
            name: "New Coin",
            symbol: "NEW",
            uri: null,
            description: null,
            offchainLoaded: false,
            isMutable: true,
          },
        }),
      }),
    );

    expect(healthy.score).toBeGreaterThan(shell.score);
  });

  it("mentions the fallback comparator when the model degraded", () => {
    const result = runAssay(
      input({
        similarity: {
          method: "lexical",
          model: "lexical-cosine-v1",
          top: 0.4,
          neighbors: [
            { originId: "a", name: "Bonk", symbol: "BONK", mint: null, similarity: 0.4, sharedTerms: ["bonk"], registered: true },
          ],
          degraded: true,
        },
      }),
    );
    expect(result.recommendation).toMatch(/lexical-cosine-v1/);
  });

  it("passes the verification reference through untouched", () => {
    expect(runAssay(input(), "abc123").verificationRef).toBe("abc123");
    expect(runAssay(input()).verificationRef).toBeNull();
  });
});