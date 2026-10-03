/**
 * Normalized domain types.
 *
 * Every externally-sourced value passes through this file before it reaches the
 * engine, the repository, or the UI. Nothing outside `src/lib/solana` is allowed
 * to import a third-party response shape.
 */

/* ------------------------------------------------------------------ *
 * Source provenance
 * ------------------------------------------------------------------ */

export type SourceStatus = "live" | "stale" | "fallback";

export interface SourceAttribution {
  /** Stable machine id, e.g. `dexscreener`. */
  id: string;
  /** Human label shown in the UI. */
  label: string;
  /** Canonical link a visitor can verify against. */
  homepage: string;
  /** Where this particular payload came from. */
  endpoint: string;
  /** ISO-8601 UTC. */
  fetchedAt: string;
  status: SourceStatus;
  /** Present only on `fallback`. */
  note?: string;
}

export interface Sourced<T> {
  data: T;
  source: SourceAttribution;
}

/* ------------------------------------------------------------------ *
 * Live Solana facts
 * ------------------------------------------------------------------ */

export type DexId =
  | "raydium"
  | "raydium-clmm"
  | "orca"
  | "meteora"
  | "pumpswap"
  | "pumpfun"
  | "sunswap"
  | "jupiter"
  | "saros"
  | "lifinity"
  | "other";

export interface LiquidityBucket {
  usd: number;
  base: number;
  quote: number;
}

export interface MarketPair {
  pairAddress: string;
  dex: DexId | string;
  label: string | null;
  url: string;
  priceUsd: number | null;
  priceChange24h: number | null;
  liquidity: LiquidityBucket;
  volume24h: number;
  txns24h: number;
  /** ISO-8601 UTC, from DexScreener `pairCreatedAt`. */
  createdAt: string | null;
  baseToken: TokenRef;
  quoteToken: TokenRef;
  /** Present when DexScreener flags the pair. */
  riskLabels: string[];
}

export interface TokenRef {
  address: string;
  name: string | null;
  symbol: string | null;
}

/**
 * Decoded Metaplex Token Metadata account.
 *
 * `name`, `symbol` and `uri` come from the on-chain metadata account, not from
 * an indexer, which is what makes an origin claim meaningful.
 */
export interface OnChainMetadata {
  mint: string;
  metadataAddress: string | null;
  updateAuthority: string | null;
  name: string | null;
  symbol: string | null;
  uri: string | null;
  /** Best-effort off-chain JSON from `uri`. */
  description: string | null;
  /** True when the off-chain JSON was fetched and parsed successfully. */
  offchainLoaded: boolean;
  primarySaleHappened: boolean | null;
  isMutable: boolean | null;
}

/**
 * Holder concentration from `getTokenLargestAccounts`.
 *
 * The public Solana RPC rate-limits this specific call, so `state` is part of
 * the type: an unavailable reading is never silently rendered as zero.
 */
export interface HolderConcentration {
  state: "ok" | "unavailable";
  /** Sum of the largest N accounts as a share of total supply, 0..1. */
  topShare: number | null;
  /** Number of largest accounts inspected. */
  accountsInspected: number;
  /** Total supply in raw base units, as a string to avoid precision loss. */
  supplyRaw: string | null;
  decimals: number | null;
  /** Why it is unavailable, when `state === "unavailable"`. */
  reason?: string;
}

export interface MintFacts {
  mint: string;
  /** True when the address is a syntactically valid base58 Solana address. */
  validAddress: boolean;
  metadata: OnChainMetadata | null;
  pairs: MarketPair[];
  /** Aggregated across all pairs. */
  liquidityUsd: number;
  volume24h: number;
  priceUsd: number | null;
  priceChange24h: number | null;
  /** ISO-8601 UTC of the oldest known pair. */
  oldestPairAt: string | null;
  ageDays: number | null;
  pairCount: number;
  dexCount: number;
  holders: HolderConcentration;
  /** Independent price reading, used to cross-check DexScreener. */
  corroboration: {
    source: "jupiter";
    priceUsd: number | null;
    /** Absolute relative difference vs DexScreener, 0..1. `null` when unavailable. */
    divergence: number | null;
  };
  sources: SourceAttribution[];
}

/* ------------------------------------------------------------------ *
 * Deterministic engine
 * ------------------------------------------------------------------ */

export const ENGINE_VERSION = "mintline-assay-v1.0.0" as const;

export type FactorKey =
  | "metadata_collision"
  | "market_depth"
  | "holder_concentration"
  | "market_age"
  | "metadata_completeness"
  | "claim_evidence";

export type FactorAvailability = "measured" | "unavailable";

export interface Factor {
  key: FactorKey;
  label: string;
  /** Weight within the engine, 0..1. Sums to 1 across all factors. */
  weight: number;
  /** Normalized 0..1 after clamping. */
  value: number;
  /** Points this factor contributed to the final score. */
  points: number;
  /** The measured quantity behind `value`, rendered verbatim in the UI. */
  evidence: string;
  /** Why the score moved in this direction. */
  rationale: string;
  availability: FactorAvailability;
}

export type Verdict =
  | "attested_origin"
  | "unregistered"
  | "collision_suspected"
  | "impersonation_likely";

export interface VerdictDefinition {
  verdict: Verdict;
  label: string;
  /** Inclusive lower bound of the score band. */
  min: number;
  max: number;
  action: string;
  summary: string;
}

export interface NeighborMatch {
  /** Id of the registered origin in *this* registry, when known. */
  originId: string | null;
  name: string;
  symbol: string | null;
  mint: string | null;
  /** 0..1 cosine similarity. */
  similarity: number;
  /** Which evidence lines drove this match. */
  sharedTerms: string[];
  /** True when the corpus entry lives in this registry. */
  registered: boolean;
}

export interface AssayInput {
  mint: string;
  /** Identity text used for collision detection, already normalized. */
  identityText: string;
  facts: MintFacts;
  similarity: SimilarityResult;
  /** Existing claims that already cover this name or symbol. */
  existingClaims: ClaimEvidence[];
}

export interface ClaimEvidence {
  originId: string;
  name: string;
  symbol: string | null;
  mint: string | null;
  verdict: Verdict;
  claimedAt: string;
}

export interface AssayResult {
  engineVersion: typeof ENGINE_VERSION;
  /** Provenance integrity, 0..100. */
  score: number;
  verdict: Verdict;
  recommendation: string;
  factors: Factor[];
  /** Weights that were unavailable, so the score is a partial computation. */
  degraded: boolean;
  /** Neighbors considered, strongest first. */
  neighbors: NeighborMatch[];
  /** Exact collisions found on symbol or normalized name. */
  exactCollisions: ClaimEvidence[];
  /** Seal of the most recent audit event considered by the engine, if any. */
  verificationRef: string | null;
  computedAt: string;
}

export type SimilarityMethod = "neural" | "lexical";

export interface SimilarityResult {
  method: SimilarityMethod;
  /** Model or algorithm identifier, surfaced in the UI. */
  model: string;
  /** 0..1 cosine similarity of the top neighbor, or 0 when the corpus is empty. */
  top: number;
  neighbors: NeighborMatch[];
  /** True when the embedding model failed and the lexical fallback was used. */
  degraded: boolean;
}

/* ------------------------------------------------------------------ *
 * Registry entity
 * ------------------------------------------------------------------ */

export type ClaimStatus = "registered" | "disputed" | "retired";

export interface OriginRecord {
  id: string;
  sessionId: string;
  mint: string;
  name: string;
  symbol: string | null;
  description: string | null;
  claimNote: string | null;
  claimedAt: string;
  status: ClaimStatus;
  /** Denormalized latest assay, so list views need no recomputation. */
  assay: AssayResult | null;
  /** Head of this record's audit chain. */
  chainHead: string;
  eventCount: number;
  shareToken: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ChainEvent {
  seq: number;
  originId: string;
  eventType: string;
  payload: Record<string, unknown>;
  canonical: string;
  prevSeal: string;
  seal: string;
  createdAt: string;
}

export interface ReplayResult {
  originId: string;
  ok: boolean;
  checked: number;
  genesis: string;
  headSeal: string | null;
  /** `null` when the chain is intact. */
  brokenAtSeq: number | null;
  brokenReason: string | null;
  events: ChainEvent[];
}

/* ------------------------------------------------------------------ *
 * Agent / MCP
 * ------------------------------------------------------------------ */

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

/* ------------------------------------------------------------------ *
 * API envelopes
 * ------------------------------------------------------------------ */

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}