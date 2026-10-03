/**
 * The assay engine.
 *
 * One pure function, `runAssay`, is the only place a provenance score is ever
 * computed. The REST route, the agent tool and the UI all call it with the same
 * argument shape, so a score can never disagree with itself across surfaces.
 *
 * ## Score definition
 *
 * `score` is a **Provenance Integrity** score in 0..100: how well a mint's
 * identity stands up against the registry and against live chain facts. Higher
 * is better.
 *
 *     score = round( 100 * Σ ( weight_i * value_i ) )     for measured factors
 *
 * When a factor cannot be measured it contributes nothing and the result is
 * flagged `degraded`, so a partial computation is never presented as a full
 * one. The engine deliberately does not reweight around the gap: a missing
 * holder reading must lower confidence, not quietly inflate the score.
 *
 * ## Why these factors
 *
 *  - `metadata_collision` dominates, because impersonation is the failure mode
 *    this product exists to catch.
 *  - `holder_concentration` is the classic wash-pattern signal, but it is the
 *    factor most often unavailable on the public RPC, so it is weighted below
 *    collision and above the cosmetic factors.
 *  - `market_depth` and `market_age` separate a real, traded asset from a
 *    freshly deployed shell.
 *  - `metadata_completeness` is cheap and genuinely discriminating: a token with
 *    no URI and no description has no inspectable origin story at all.
 *  - `claim_evidence` rewards a registered, attested claim, which is what makes
 *    the registry worth writing into.
 *
 * ## Stability
 *
 * Ties break on factor key, `localeCompare` with an explicit locale, and every
 * aggregate is rounded to a fixed number of decimals, so repeated runs on the
 * same input are byte-identical.
 */

import {
  ENGINE_VERSION,
  type AssayInput,
  type AssayResult,
  type ClaimEvidence,
  type Factor,
  type FactorKey,
  type MintFacts,
  type NeighborMatch,
  type VerdictDefinition,
} from "../types";

export const ENGINE_WEIGHTS: Record<FactorKey, number> = {
  metadata_collision: 0.34,
  holder_concentration: 0.16,
  market_depth: 0.18,
  market_age: 0.1,
  metadata_completeness: 0.12,
  claim_evidence: 0.1,
};

export const VERDICT_BANDS: VerdictDefinition[] = [
  {
    verdict: "attested_origin",
    label: "Attested origin",
    min: 75,
    max: 100,
    summary: "No meaningful collision, real market depth, and an inspectable identity.",
    action: "Safe to attest. Record the claim in the registry and keep the dossier.",
  },
  {
    verdict: "unregistered",
    label: "Unregistered",
    min: 55,
    max: 74,
    summary: "No collision found, but the evidence for a clean origin is incomplete.",
    action: "Ask the issuer for a signed origin statement before accepting the identity.",
  },
  {
    verdict: "collision_suspected",
    label: "Collision suspected",
    min: 35,
    max: 54,
    summary: "The identity text resembles a registered origin closely enough to matter.",
    action: "Treat the name as unproven. Compare the two metadata records before trading or bridging.",
  },
  {
    verdict: "impersonation_likely",
    label: "Impersonation likely",
    min: 0,
    max: 34,
    summary: "Strong collision with an existing origin and thin independent evidence.",
    action: "Do not treat this identity as authentic. Report the mint to the issuer of the matched origin.",
  },
];

export function classify(score: number): VerdictDefinition {
  const clamped = Math.max(0, Math.min(100, score));
  for (const band of VERDICT_BANDS) {
    if (clamped >= band.min && clamped <= band.max) return band;
  }
  // Unreachable while the bands tile 0..100, but kept so a future edit to the
  // bands degrades into a defined answer rather than undefined behaviour.
  return VERDICT_BANDS[VERDICT_BANDS.length - 1];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Map a magnitude onto 0..1 with an explicit half-power point.
 *
 * Used for log-scaled quantities (liquidity, age) where doubling should matter
 * roughly as much as the previous step. `halfAt` is the value that yields 0.5.
 */
function logScale(value: number, halfAt: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (halfAt <= 0) return 0;
  return clamp01(Math.log2(value / halfAt) / 2 + 0.5);
}

/** Deterministic ordering for neighbor lists: score desc, then name asc. */
export function sortNeighbors(neighbors: NeighborMatch[]): NeighborMatch[] {
  return [...neighbors].sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    if (an < bn) return -1;
    if (an > bn) return 1;
    return 0;
  });
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "unavailable";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

/* ------------------------------------------------------------------ *
 * Individual factors
 * ------------------------------------------------------------------ */

function collisionFactor(input: AssayInput): Factor {
  const { similarity, identityText, existingClaims, facts } = input;
  const name = facts.metadata?.name ?? "";
  const symbol = facts.metadata?.symbol ?? "";

  let value: number;
  const evidenceParts: string[] = [];

  if (existingClaims.length > 0) {
    // An exact normalized name or symbol match outranks any fuzzy score.
    value = 0;
    evidenceParts.push(
      `exact match on ${existingClaims.map((c: ClaimEvidence) => c.symbol ?? c.name).join(", ")}`,
    );
  } else if (similarity.neighbors.length === 0) {
    value = 0.5;
    evidenceParts.push("empty comparison corpus, collision untestable");
  } else {
    value = clamp01(1 - similarity.top);
    evidenceParts.push(`closest match ${similarity.top.toFixed(3)} via ${similarity.method}`);
  }

  const emptyIdentity = identityText.trim().length === 0;
  if (emptyIdentity) {
    value = 0.5;
    evidenceParts.length = 0;
    evidenceParts.push("no identity text on chain to compare");
  }

  const identityLabel = [name, symbol].filter(Boolean).join(" / ") || "unnamed mint";

  return {
    key: "metadata_collision",
    label: "Metadata collision",
    weight: ENGINE_WEIGHTS.metadata_collision,
    value: round(value, 4),
    points: 0,
    evidence: `${identityLabel}; ${evidenceParts.join("; ")}`,
    rationale: existingClaims.length
      ? "An exact name or symbol collision is disqualifying on its own."
      : "Score falls as the identity text approaches an existing registered origin.",
    availability: emptyIdentity || similarity.neighbors.length === 0 ? "unavailable" : "measured",
  };
}

function depthFactor(facts: MintFacts): Factor {
  const liquidity = facts.liquidityUsd;
  const available = Number.isFinite(liquidity) && liquidity > 0;

  const value = available ? logScale(liquidity, 20_000) : 0;
  const pairNote =
    facts.pairCount === 0
      ? "no trading pair found"
      : `${facts.pairCount} pair${facts.pairCount === 1 ? "" : "s"} across ${facts.dexCount} venue${facts.dexCount === 1 ? "" : "s"}`;

  return {
    key: "market_depth",
    label: "Market depth",
    weight: ENGINE_WEIGHTS.market_depth,
    value: round(value, 4),
    points: 0,
    evidence: available
      ? `liquidity ${formatUsd(liquidity)}; 24h volume ${formatUsd(facts.volume24h)}; ${pairNote}`
      : `liquidity unavailable; ${pairNote}`,
    rationale: "Deep, multi-venue liquidity is hard to fake cheaply; a thin book is easy to manufacture.",
    availability: available ? "measured" : "unavailable",
  };
}

function concentrationFactor(facts: MintFacts): Factor {
  const holders = facts.holders;

  if (holders.state !== "ok" || holders.topShare === null) {
    return {
      key: "holder_concentration",
      label: "Holder concentration",
      weight: ENGINE_WEIGHTS.holder_concentration,
      value: 0,
      points: 0,
      evidence: `unavailable — ${holders.reason ?? "no reading"}`,
      rationale: "Concentrated supply is a wash-pattern signal, but this reading was not obtainable.",
      availability: "unavailable",
    };
  }

  // 0% top share -> perfect 1.0; 60%+ top share -> 0.
  const value = clamp01(1 - holders.topShare / 0.6);

  return {
    key: "holder_concentration",
    label: "Holder concentration",
    weight: ENGINE_WEIGHTS.holder_concentration,
    value: round(value, 4),
    points: 0,
    evidence: `top ${holders.accountsInspected} accounts hold ${(holders.topShare * 100).toFixed(1)}% of supply`,
    rationale: "Supply held by a handful of accounts is the classic signature of a manufactured market.",
    availability: "measured",
  };
}

function ageFactor(facts: MintFacts): Factor {
  const age = facts.ageDays;

  if (age === null || !Number.isFinite(age)) {
    return {
      key: "market_age",
      label: "Market age",
      weight: ENGINE_WEIGHTS.market_age,
      value: 0,
      points: 0,
      evidence: "unavailable — no pair creation date returned by any source",
      rationale: "A market with no trading history has had no time to establish a record.",
      availability: "unavailable",
    };
  }

  // 0 days -> 0; 180 days or more -> 1.
  const value = clamp01(age / 180);

  return {
    key: "market_age",
    label: "Market age",
    weight: ENGINE_WEIGHTS.market_age,
    value: round(value, 4),
    points: 0,
    evidence: `oldest pair ${age.toFixed(1)} days old (${facts.oldestPairAt ?? "date unknown"})`,
    rationale: "Time traded is the cheapest evidence available; minutes-old markets carry no history.",
    availability: "measured",
  };
}

function completenessFactor(facts: MintFacts): Factor {
  const metadata = facts.metadata;
  const checks: Array<[boolean, string]> = [
    [Boolean(metadata?.name && metadata.name.trim().length > 0), "name present"],
    [Boolean(metadata?.symbol && metadata.symbol.trim().length > 0), "symbol present"],
    [Boolean(metadata?.uri && metadata.uri.trim().length > 0), "off-chain URI set"],
    [Boolean(metadata?.offchainLoaded), "URI resolved and parsed"],
    [
      Boolean(metadata?.description && metadata.description.trim().length >= 40),
      "description of real length",
    ],
    [metadata?.isMutable === false, "metadata is immutable"],
  ];

  const passed = checks.filter(([ok]) => ok).length;
  const value = passed / checks.length;

  const missing = checks
    .filter(([ok]) => !ok)
    .map(([, label]) => label)
    .slice(0, 3);

  return {
    key: "metadata_completeness",
    label: "Metadata completeness",
    weight: ENGINE_WEIGHTS.metadata_completeness,
    value: round(value, 4),
    points: 0,
    evidence:
      passed === checks.length
        ? `all ${checks.length} metadata checks passed`
        : `${passed}/${checks.length} checks passed; missing ${missing.join(", ")}`,
    rationale: "A complete, immutable metadata record is an origin claim; an empty one is not.",
    availability: metadata ? "measured" : "unavailable",
  };
}

function claimFactor(existingClaims: ClaimEvidence[]): Factor {
  if (existingClaims.length === 0) {
    return {
      key: "claim_evidence",
      label: "Claim evidence",
      weight: ENGINE_WEIGHTS.claim_evidence,
      value: 0.35,
      points: 0,
      evidence: "no prior claim recorded for this identity",
      rationale: "An unclaimed identity is not wrong, but nobody has put their name on it yet.",
      availability: "measured",
    };
  }

  const registered = existingClaims.filter((c) => c.verdict === "attested_origin").length;
  const disputed = existingClaims.filter((c) => c.verdict !== "attested_origin").length;

  // Any dispute caps the factor: contested evidence is weaker than none.
  const value = disputed > 0 ? 0.15 : 0.35 + Math.min(registered, 3) * 0.2167;

  return {
    key: "claim_evidence",
    label: "Claim evidence",
    weight: ENGINE_WEIGHTS.claim_evidence,
    value: round(clamp01(value), 4),
    points: 0,
    evidence: `${existingClaims.length} prior claim${existingClaims.length === 1 ? "" : "s"} (${registered} attested, ${disputed} contested); oldest ${existingClaims
      .map((c) => c.claimedAt)
      .sort()[0]}`,
    rationale: "An attested prior claim strengthens provenance; a contested one weakens it sharply.",
    availability: "measured",
  };
}

const FACTOR_ORDER: FactorKey[] = [
  "metadata_collision",
  "market_depth",
  "holder_concentration",
  "market_age",
  "metadata_completeness",
  "claim_evidence",
];

/**
 * Run the assay.
 *
 * `verificationRef` is passed through rather than computed here: the engine is
 * pure and must not read the database to find the current chain head.
 */
export function runAssay(input: AssayInput, verificationRef: string | null = null): AssayResult {
  const built: Record<FactorKey, Factor> = {
    metadata_collision: collisionFactor(input),
    market_depth: depthFactor(input.facts),
    holder_concentration: concentrationFactor(input.facts),
    market_age: ageFactor(input.facts),
    metadata_completeness: completenessFactor(input.facts),
    claim_evidence: claimFactor(input.existingClaims),
  };

  const factors: Factor[] = FACTOR_ORDER.map((key) => {
    const factor = built[key];
    const points = round(factor.weight * factor.value * 100, 3);
    return { ...factor, points };
  });

  const score = round(
    Math.max(0, Math.min(100, factors.reduce((sum, f) => sum + f.points, 0))),
    2,
  );

  const band = classify(score);
  const degraded = factors.some((f) => f.availability === "unavailable");

  const topNeighbor = input.similarity.neighbors[0];
  const reasoning =
    input.similarity.degraded && topNeighbor
      ? ` Closest registered origin is ${topNeighbor.name} at ${topNeighbor.similarity.toFixed(3)}, measured by the ${input.similarity.model} fallback rather than the neural model.`
      : "";

  return {
    engineVersion: ENGINE_VERSION,
    score,
    verdict: band.verdict,
    recommendation: band.action + reasoning,
    factors,
    degraded,
    neighbors: input.similarity.neighbors,
    exactCollisions: input.existingClaims,
    verificationRef,
    computedAt: new Date().toISOString(),
  };
}

/** Documented weights, surfaced on `/assay` so the formula is never a secret. */
export function describeEngine(): {
  version: typeof ENGINE_VERSION;
  weights: Array<{ key: FactorKey; weight: number; label: string }>;
  bands: VerdictDefinition[];
} {
  return {
    version: ENGINE_VERSION,
    weights: FACTOR_ORDER.map((key) => ({
      key,
      weight: ENGINE_WEIGHTS[key],
      label: builtLabelFallback(key),
    })),
    bands: VERDICT_BANDS,
  };
}

function builtLabelFallback(key: FactorKey): string {
  const labels: Record<FactorKey, string> = {
    metadata_collision: "Metadata collision",
    market_depth: "Market depth",
    holder_concentration: "Holder concentration",
    market_age: "Market age",
    metadata_completeness: "Metadata completeness",
    claim_evidence: "Claim evidence",
  };
  return labels[key];
}