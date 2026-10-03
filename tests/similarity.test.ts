import { describe, expect, it } from "vitest";
import {
  cosineDense,
  findExactCollisions,
  identityKey,
  identityTokens,
  lexicalSimilarity,
  normalizeIdentityText,
  type CorpusEntry,
} from "@/lib/engine/similarity";
import type { ClaimEvidence } from "@/lib/types";

const CORPUS: CorpusEntry[] = [
  {
    originId: "seed:bonk",
    name: "Bonk",
    symbol: "BONK",
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    text: "Bonk is the mascot coin of the bonk.fun launchpad on Solana and one of the first widely distributed Solana meme coins.",
    registered: false,
  },
  {
    originId: "seed:usdc",
    name: "USD Coin",
    symbol: "USDC",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    text: "USD Coin is a fully reserved digital dollar issued by Circle, designed to be a stable transparent digital dollar pegged to the US dollar.",
    registered: false,
  },
  {
    originId: "o_mine",
    name: "Acorn",
    symbol: "ACRN",
    mint: "Mine1111111111111111111111111111111111111111",
    text: "Acorn is a test asset used by the Mintline unit suite to exercise collision detection.",
    registered: true,
  },
];

describe("normalizeIdentityText", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeIdentityText("Bonk, The Second!")).toBe("bonk the second");
  });

  it("strips URLs so they cannot dominate the comparison", () => {
    expect(normalizeIdentityText("Visit https://bonk.fun now")).not.toContain("http");
  });

  it("removes diacritics", () => {
    expect(normalizeIdentityText("Crème")).toBe("creme");
  });

  it("collapses whitespace", () => {
    expect(normalizeIdentityText("  a   b  ")).toBe("a b");
  });

  it("is idempotent", () => {
    const once = normalizeIdentityText("Bonk!  SOL");
    expect(normalizeIdentityText(once)).toBe(once);
  });

  it("handles an empty string", () => {
    expect(normalizeIdentityText("")).toBe("");
  });
});

describe("identityTokens", () => {
  it("drops generic marketing words", () => {
    const tokens = identityTokens("The official Solana token protocol coin chain");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("solana");
    expect(tokens).not.toContain("official");
    expect(tokens).not.toContain("token");
    expect(tokens).not.toContain("coin");
    expect(tokens).not.toContain("chain");
    expect(tokens).toEqual([]);
  });

  it("keeps words that carry identity signal", () => {
    const tokens = identityTokens("Bonk meme launchpad dog coin");
    expect(tokens).toEqual(["bonk", "dog", "launchpad", "meme"]);
  });

  it("is sorted and deduplicated", () => {
    const tokens = identityTokens("zebra apple zebra");
    expect(tokens).toEqual(["apple", "zebra"]);
  });

  it("returns nothing for empty input", () => {
    expect(identityTokens("")).toEqual([]);
  });
});

describe("identityKey", () => {
  it("collapses a rename that only adds separators", () => {
    expect(identityKey("Bonk Inu")).toBe(identityKey("BonkInu"));
  });

  it("keeps genuinely different names apart", () => {
    expect(identityKey("Bonk")).not.toBe(identityKey("Doge"));
  });
});

describe("lexicalSimilarity", () => {
  it("separates a near copy from an unrelated identity by a wide margin", () => {
    const near = lexicalSimilarity(
      "Bonk is the mascot coin of the bonk.fun launchpad on Solana",
      CORPUS,
    );
    const far = lexicalSimilarity(
      "Quarterly warehouse inventory reconciliation for freight logistics",
      CORPUS,
    );

    expect(near.neighbors[0].name).toBe("Bonk");
    expect(near.top).toBeGreaterThan(0.6);
    expect(far.top).toBeLessThan(near.top / 2);
  });

  it("returns an exact 1.0 when the identity keys match", () => {
    const corpus: CorpusEntry[] = [
      {
        originId: "x",
        name: "Zephyr",
        symbol: "ZPH",
        mint: null,
        text: "Zephyr ZPH",
        registered: true,
      },
    ];
    const result = lexicalSimilarity("Zephyr ZPH", corpus);
    expect(result.neighbors[0].similarity).toBe(1);
  });

  it("does not treat a bare name as identical to a long description", () => {
    // "bonk" alone is not the same identity text as the full Bonk record, so it
    // must not be reported as an exact collision.
    const result = lexicalSimilarity("bonk", CORPUS);
    const bonk = result.neighbors.find((n) => n.name === "Bonk");
    expect(bonk?.similarity).toBeLessThan(1);
    expect(bonk?.similarity).toBeGreaterThan(0);
  });

  it("scores an unrelated identity low", () => {
    const result = lexicalSimilarity("Completely different widget catalogue", CORPUS);
    expect(result.top).toBeLessThan(0.5);
  });

  it("lists neighbours strongest first", () => {
    const result = lexicalSimilarity("Bonk mascot launchpad Solana", CORPUS);
    for (let i = 1; i < result.neighbors.length; i += 1) {
      expect(result.neighbors[i - 1].similarity).toBeGreaterThanOrEqual(result.neighbors[i].similarity);
    }
  });

  it("breaks ties by name so output is stable", () => {
    const tied: CorpusEntry[] = [
      { originId: "1", name: "Zeta", symbol: null, mint: null, text: "same text here", registered: true },
      { originId: "2", name: "Alpha", symbol: null, mint: null, text: "same text here", registered: true },
    ];
    const first = lexicalSimilarity("same text here", tied);
    const second = lexicalSimilarity("same text here", [...tied].reverse());
    expect(first.neighbors.map((n) => n.name)).toEqual(second.neighbors.map((n) => n.name));
    expect(first.neighbors[0].name).toBe("Alpha");
  });

  it("explains a match with the shared terms", () => {
    const result = lexicalSimilarity("Bonk mascot coin launchpad", CORPUS);
    expect(result.neighbors[0].sharedTerms).toContain("bonk");
  });

  it("returns an empty neighbour list for an empty corpus", () => {
    const result = lexicalSimilarity("anything", []);
    expect(result.neighbors).toHaveLength(0);
    expect(result.top).toBe(0);
  });

  it("returns an empty neighbour list for empty identity text", () => {
    const result = lexicalSimilarity("", CORPUS);
    expect(result.top).toBe(0);
  });

  it("marks itself as degraded because no model ran", () => {
    expect(lexicalSimilarity("Bonk", CORPUS).degraded).toBe(true);
    expect(lexicalSimilarity("Bonk", CORPUS).method).toBe("lexical");
  });

  it("is deterministic across repeated runs", () => {
    const a = lexicalSimilarity("Acorn test asset", CORPUS);
    const b = lexicalSimilarity("Acorn test asset", CORPUS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("respects the limit", () => {
    const result = lexicalSimilarity("token", CORPUS, { limit: 1 });
    expect(result.neighbors.length).toBeLessThanOrEqual(1);
  });

  it("respects the threshold", () => {
    const strict = lexicalSimilarity("Acorn test asset", CORPUS, { threshold: 0.99 });
    expect(strict.neighbors.every((n) => n.similarity >= 0.99)).toBe(true);
  });

  it("keeps every similarity inside 0..1", () => {
    const result = lexicalSimilarity("Bonk", CORPUS);
    for (const neighbor of result.neighbors) {
      expect(neighbor.similarity).toBeGreaterThanOrEqual(0);
      expect(neighbor.similarity).toBeLessThanOrEqual(1);
    }
  });
});

describe("findExactCollisions", () => {
  const claims: ClaimEvidence[] = [
    {
      originId: "seed:bonk",
      name: "Bonk",
      symbol: "BONK",
      mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      verdict: "attested_origin",
      claimedAt: "2022-12-24T00:00:00.000Z",
    },
    {
      originId: "o_other",
      name: "Acorn",
      symbol: "ACRN",
      mint: "Mine1111111111111111111111111111111111111111",
      verdict: "unregistered",
      claimedAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  it("matches on a normalised-identical name", () => {
    const found = findExactCollisions("bonk", null, claims, false);
    expect(found.map((c) => c.originId)).toContain("seed:bonk");
  });

  it("matches on an exact symbol when symbol matching is on", () => {
    const found = findExactCollisions("Totally Different Name", "BONK", claims, true);
    expect(found.map((c) => c.originId)).toContain("seed:bonk");
  });

  it("ignores the symbol when symbol matching is off", () => {
    const found = findExactCollisions("Totally Different Name", "BONK", claims, false);
    expect(found).toHaveLength(0);
  });

  it("does not match a different name", () => {
    expect(findExactCollisions("Doge", "DOGE", claims, true)).toHaveLength(0);
  });

  it("skips the sentinel self reference", () => {
    expect(findExactCollisions("Bonk", null, [{ ...claims[0], originId: "__self__" }], false)).toHaveLength(0);
  });
});

describe("cosineDense", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineDense([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineDense([1, 0], [0, 1])).toBe(0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineDense([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });

  it("returns 0 for a zero vector rather than NaN", () => {
    expect(cosineDense([0, 0], [1, 1])).toBe(0);
  });

  it("returns 0 for empty input", () => {
    expect(cosineDense([], [])).toBe(0);
  });
});