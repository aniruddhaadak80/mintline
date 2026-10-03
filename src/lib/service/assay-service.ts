/**
 * Assay service.
 *
 * Composes live chain facts, the collision corpus and the pure engine into one
 * answer. Every surface calls `assayMint`; none of them assemble a score
 * themselves. The only difference between callers is where the similarity comes
 * from: the server path uses the deterministic lexical comparator, and the
 * browser may upgrade it to the neural reading before calling `runAssay` again
 * through `assembleAssay`.
 */

import { runAssay } from "../engine/assay";
import {
  findExactCollisions,
  lexicalSimilarity,
  type CorpusEntry,
  type SimilarityResult,
} from "../engine/similarity";
import { loadMintFacts, type LoadOptions } from "../solana/live";
import { isSampleMint } from "../solana/fallback";
import { identityTextFrom } from "../solana/metadata";
import { isValidSolanaAddress } from "../solana/address";
import { findClaimsFor, loadCorpus } from "../db/repository";
import type { AssayResult, ClaimEvidence, MintFacts, SimilarityMethod } from "../types";

export interface AssayRequest {
  sessionId: string;
  mint: string;
  /** Include the shared reference registry in the collision corpus. */
  includeReference?: boolean;
  /** Treat an exact ticker match as a collision. Default true. */
  matchSymbol?: boolean;
  loadOptions?: LoadOptions;
}

export interface AssayOutcome {
  facts: MintFacts;
  similarity: SimilarityResult;
  existingClaims: ClaimEvidence[];
  result: AssayResult;
}

function buildIdentityText(facts: MintFacts): string {
  if (facts.metadata) {
    return identityTextFrom(facts.metadata);
  }
  const pair = facts.pairs[0];
  if (!pair) return "";
  return [pair.baseToken.name, pair.baseToken.symbol].filter(Boolean).join(" ");
}

async function buildCorpus(
  sessionId: string,
  includeReference: boolean,
): Promise<CorpusEntry[]> {
  const rows = await loadCorpus(sessionId);
  const filtered = includeReference
    ? rows
    : rows.filter((row) => row.registered);

  return filtered.map((row) => ({
    originId: row.originId,
    name: row.name,
    symbol: row.symbol,
    mint: row.mint,
    text: row.text,
    registered: row.registered,
  }));
}

/**
 * Run the assay for a mint.
 *
 * `verificationRef` is the chain head of an existing record for the same mint in
 * this session, so an assay response carries a seal the caller can immediately
 * verify. When there is no record yet the field is `null`, which is honest.
 */
export async function assayMint(request: AssayRequest): Promise<AssayOutcome> {
  const mint = request.mint.trim();
  const includeReference = request.includeReference ?? true;
  const matchSymbol = request.matchSymbol ?? true;

  const facts = await loadMintFacts(mint, request.loadOptions ?? { allowFallback: true });
  const identityText = buildIdentityText(facts);

  const corpus = await buildCorpus(request.sessionId, includeReference);

  // A token is never compared against itself just because it is already
  // registered here; that would report a 1.000 collision with its own claim.
  const selfMint = mint;
  const corpusWithoutSelf = corpus.filter((entry) => entry.mint !== selfMint);

  const similarity = lexicalSimilarity(identityText, corpusWithoutSelf);

  const symbol = facts.metadata?.symbol ?? facts.pairs[0]?.baseToken.symbol ?? null;
  const allClaims = await findClaimsFor(request.sessionId, identityText, symbol, matchSymbol);
  const existingClaims = allClaims.filter((claim) => claim.mint !== selfMint);

  const result = runAssay(
    {
      mint,
      identityText,
      facts,
      similarity,
      existingClaims,
    },
    null,
  );

  return { facts, similarity, existingClaims, result };
}

/**
 * Re-run the pure engine with a similarity reading measured elsewhere.
 *
 * Used by the browser after its on-device model produces embeddings. The engine
 * itself is unchanged, so a neural score and a lexical score are directly
 * comparable and both are reproducible from their stated inputs.
 */
export function assembleAssay(input: {
  sessionId: string;
  mint: string;
  facts: MintFacts;
  similarity: SimilarityResult;
  existingClaims: ClaimEvidence[];
  matchSymbol?: boolean;
}): AssayResult {
  const identityText = buildIdentityText(input.facts);
  return runAssay(
    {
      mint: input.mint,
      identityText,
      facts: input.facts,
      similarity: input.similarity,
      existingClaims: input.existingClaims,
    },
    null,
  );
}

/** Re-run only the comparator part, given facts the client already fetched. */
export async function reassembleWithSimilarity(input: {
  sessionId: string;
  facts: MintFacts;
  similarity: SimilarityResult;
  matchSymbol?: boolean;
}): Promise<AssayOutcome> {
  const matchSymbol = input.matchSymbol ?? true;
  const identityText = buildIdentityText(input.facts);
  const symbol = input.facts.metadata?.symbol ?? input.facts.pairs[0]?.baseToken.symbol ?? null;
  const allClaims = await findClaimsFor(input.sessionId, identityText, symbol, matchSymbol);
  const existingClaims = allClaims.filter((claim) => claim.mint !== input.facts.mint);

  const result = runAssay(
    {
      mint: input.facts.mint,
      identityText,
      facts: input.facts,
      similarity: input.similarity,
      existingClaims,
    },
    null,
  );

  return { facts: input.facts, similarity: input.similarity, existingClaims, result };
}

export { isValidSolanaAddress, isSampleMint, buildIdentityText, findExactCollisions };

/** Method label used in the UI when explaining which comparator ran. */
export function methodLabel(method: SimilarityMethod): string {
  return method === "neural"
    ? "on-device sentence embeddings"
    : "lexical n-gram comparator (server default)";
}