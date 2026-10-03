/**
 * Collision similarity.
 *
 * Two implementations, one output shape:
 *
 *  - `lexicalSimilarity` — character n-gram cosine plus token overlap. Pure,
 *    deterministic, no model, no network. This is what the REST route and the
 *    agent tools use, so a score computed without a browser is still real.
 *  - the neural path lives in `src/lib/engine/embed.ts`, is loaded only in the
 *    browser via `next/dynamic`, and returns the same shape. The UI re-runs the
 *    engine with it, and the response says which one produced the number.
 *
 * A neural reading is never silently substituted for a lexical one: the method
 * and model id travel with the result all the way into the audit payload.
 */

import type {
  ClaimEvidence,
  NeighborMatch,
  SimilarityResult,
} from "../types";

export const LEXICAL_MODEL_ID = "lexical-cosine-v1 (char 3-gram + token overlap)";

/** Terms that carry no identity signal and would inflate every score. */
const STOP_TOKENS = new Set([
  "the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "with", "by",
  "is", "are", "was", "were", "be", "it", "its", "this", "that", "as", "at",
  "from", "token", "coin", "protocol", "network", "chain", "solana", "official",
]);

/** Collapses case, strips punctuation and diacritics, collapses whitespace. */
export function normalizeIdentityText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Content tokens, longest first so greedy phrase matching stays stable. */
export function identityTokens(input: string): string[] {
  const normalized = normalizeIdentityText(input);
  if (!normalized) return [];
  const raw = normalized.split(" ").filter((t) => t.length > 1 && !STOP_TOKENS.has(t));
  return [...new Set(raw)].sort();
}

/** Loose key used to catch a rename like "Bonk Inu" vs "BonkInu". */
export function identityKey(input: string): string {
  return identityTokens(input).join("");
}

function charNgrams(input: string, n = 3): string[] {
  const padded = ` ${input} `;
  const grams: string[] = [];
  for (let i = 0; i + n <= padded.length; i += 1) {
    grams.push(padded.slice(i, i + n));
  }
  return grams;
}

function termFrequency(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const token of tokens) {
    map.set(token, (map.get(token) ?? 0) + 1);
  }
  return map;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [, value] of a) normA += value * value;
  for (const [key, value] of b) {
    normB += value * value;
    const other = a.get(key);
    if (other) dot += other * value;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Jaccard over content tokens, used to explain a match in words. */
function tokenOverlap(a: string[], b: string[]): { score: number; shared: string[] } {
  if (a.length === 0 || b.length === 0) return { score: 0, shared: [] };
  const setB = new Set(b);
  const shared = a.filter((t) => setB.has(t));
  const union = new Set([...a, ...b]);
  return {
    score: shared.length / union.size,
    shared: shared.sort(),
  };
}

export interface CorpusEntry {
  /** `null` for a curated reference token that is not in this registry. */
  originId: string | null;
  name: string;
  symbol: string | null;
  mint: string | null;
  /** Full identity text: name, symbol and description. */
  text: string;
  /** `true` when this entry came from a live on-chain claim in this registry. */
  registered: boolean;
}

export interface LexicalOptions {
  /** Only return neighbors at or above this similarity. */
  threshold?: number;
  /** Max neighbors to return. */
  limit?: number;
}

/**
 * Deterministic lexical similarity of `identityText` against `corpus`.
 *
 * The blended score is `0.6 * charNgramCosine + 0.4 * tokenJaccard`. Character
 * grams catch the copycat cases that token overlap misses ("Bonk2" vs "Bonk"),
 * and token overlap stops two unrelated strings from matching on shared
 * letters alone.
 */
export function lexicalSimilarity(
  identityText: string,
  corpus: CorpusEntry[],
  options: LexicalOptions = {},
): SimilarityResult {
  const threshold = options.threshold ?? 0.12;
  const limit = options.limit ?? 6;

  const normalized = normalizeIdentityText(identityText);
  const targetGrams = termFrequency(charNgrams(normalized));
  const targetTokens = identityTokens(identityText);

  const neighbors: NeighborMatch[] = [];

  for (const entry of corpus) {
    const candidateKey = identityKey(entry.text);
    const targetKey = identityKey(identityText);
    const exact = targetKey.length > 0 && candidateKey === targetKey;

    const entryNormalized = normalizeIdentityText(entry.text);
    const gramScore = cosine(targetGrams, termFrequency(charNgrams(entryNormalized)));
    const overlap = tokenOverlap(targetTokens, identityTokens(entry.text));

    let blended = 0.6 * gramScore + 0.4 * overlap.score;
    if (exact) blended = 1;

    if (blended < threshold) continue;

    neighbors.push({
      originId: entry.originId,
      name: entry.name || entry.symbol || "unnamed",
      symbol: entry.symbol,
      mint: entry.mint,
      similarity: Math.round(Math.min(1, blended) * 10000) / 10000,
      sharedTerms: overlap.shared.slice(0, 8),
      registered: entry.registered,
    });
  }

  neighbors.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  return {
    method: "lexical",
    model: LEXICAL_MODEL_ID,
    top: neighbors.length > 0 ? neighbors[0].similarity : 0,
    neighbors: neighbors.slice(0, limit),
    degraded: true,
  };
}

/**
 * Find existing registry claims for a candidate identity.
 *
 * Matching is deliberately generous: a claim collides when it shares the
 * normalized key, or when it shares the exact symbol. This is the signal that
 * turns "similar" into "disqualified", so it is intentionally not fuzzy.
 */
export function findExactCollisions(
  identityText: string,
  symbol: string | null,
  claims: ClaimEvidence[],
  matchSymbol: boolean,
): ClaimEvidence[] {
  const key = identityKey(identityText);
  const symbolKey = matchSymbol && symbol ? normalizeIdentityText(symbol) : "";

  return claims.filter((claim) => {
    if (claim.originId === "__self__") return false;
    const claimKey = identityKey(`${claim.name} ${claim.symbol ?? ""}`);
    if (key.length > 0 && claimKey === key) return true;
    if (symbolKey.length > 0 && normalizeIdentityText(claim.symbol ?? "") === symbolKey) return true;
    return false;
  });
}
export type { SimilarityResult };

/** Cosine similarity for caller-supplied dense vectors. Used by the neural path. */
export function cosineDense(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}