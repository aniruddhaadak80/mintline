/**
 * Live Solana facts for one mint, assembled from three independent key-free
 * public sources.
 *
 * | Source        | What it contributes                        | Failure behaviour                |
 * |---------------|--------------------------------------------|----------------------------------|
 * | Solana RPC    | on-chain metadata, supply, holder spread   | metadata/supply degraded, recorded|
 * | DexScreener   | pairs, liquidity, volume, price            | depth unavailable               |
 * | Jupiter       | independent price corroboration             | divergence reported as `null`   |
 *
 * No API key is required by any of them. Nothing here throws: every source
 * failure degrades a specific field and records why, so the engine can report
 * `degraded: true` rather than the UI pretending a reading exists.
 */

import { fetchJson, isAllowedMetadataUrl, attribution } from "../http";
import { deriveMetadataAddress } from "./address";
import { decodeTokenMetadata, toOnChainMetadata, type RawTokenMetadata } from "./metadata";
import { FALLBACK_FIXTURES, fallbackFacts } from "./fallback";
import type {
  DexId,
  HolderConcentration,
  MarketPair,
  MintFacts,
  OnChainMetadata,
  SourceAttribution,
} from "../types";

const RPC_ENDPOINT = "https://api.mainnet-beta.solana.com";
const RPC_METHODS = ["getAccountInfo", "getTokenSupply", "getTokenLargestAccounts"];

export const SOURCE_INFO = {
  solanaRpc: {
    id: "solana-rpc",
    label: "Solana public RPC",
    homepage: "https://solana.com/docs/rpc",
    endpoint: RPC_ENDPOINT,
  },
  dexscreener: {
    id: "dexscreener",
    label: "DexScreener",
    homepage: "https://dexscreener.com",
    endpoint: "https://api.dexscreener.com/latest/dex/tokens/{mint}",
  },
  jupiter: {
    id: "jupiter",
    label: "Jupiter price API",
    homepage: "https://docs.jup.ag",
    endpoint: "https://lite-api.jup.ag/price/v3",
  },
} as const;

async function rpc<T>(method: string, params: unknown[], timeoutMs = 7_000): Promise<{
  ok: boolean;
  data?: T;
  error?: string;
  httpStatus: number | null;
}> {
  const result = await fetchJson<{ result?: T; error?: { message?: string } }>(
    RPC_ENDPOINT,
    {
      method: "POST",
      body: { jsonrpc: "2.0", id: 1, method, params },
      timeoutMs,
      // Rate limiting is expected on the public endpoint; one retry only.
      retries: 1,
      revalidateSeconds: 30,
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.error, httpStatus: result.httpStatus };
  }
  if (result.data.error) {
    return {
      ok: false,
      error: result.data.error.message ?? "rpc error",
      httpStatus: result.httpStatus,
    };
  }
  return { ok: true, data: result.data.result, httpStatus: result.httpStatus };
}

/* ------------------------------------------------------------------ *
 * Solana RPC
 * ------------------------------------------------------------------ */

async function loadMetadata(
  mint: string,
): Promise<{ metadata: OnChainMetadata | null; attribution: SourceAttribution | null; note?: string }> {
  let metadataAddress: string;
  try {
    metadataAddress = deriveMetadataAddress(mint).address;
  } catch (error) {
    return {
      metadata: null,
      attribution: null,
      note: error instanceof Error ? error.message : "invalid mint address",
    };
  }

  const account = await rpc<{
    value: { data: [string, string]; owner: string } | null;
  }>("getAccountInfo", [metadataAddress, { encoding: "base64" }]);

  const fetchedAt = new Date().toISOString();

  if (!account.ok || !account.data?.value) {
    return {
      metadata: null,
      attribution: {
        ...SOURCE_INFO.solanaRpc,
        endpoint: `${RPC_ENDPOINT} # getAccountInfo(${metadataAddress})`,
        fetchedAt,
        status: "fallback",
        note: account.error ?? "no metadata account at the derived address",
      },
    };
  }

  const raw: RawTokenMetadata | null = decodeTokenMetadata(account.data.value.data[0], mint);

  if (!raw) {
    return {
      metadata: null,
      attribution: {
        ...SOURCE_INFO.solanaRpc,
        endpoint: `${RPC_ENDPOINT} # getAccountInfo(${metadataAddress})`,
        fetchedAt,
        status: "fallback",
        note: "metadata account present but could not be decoded",
      },
    };
  }

  const offchain = await loadOffchainMetadata(raw.uri);

  const decoded = toOnChainMetadata(raw, offchain);
  decoded.metadataAddress = metadataAddress;

  return {
    metadata: decoded,
    attribution: {
      ...SOURCE_INFO.solanaRpc,
      endpoint: `${RPC_ENDPOINT} # getAccountInfo(${metadataAddress})`,
      fetchedAt,
      status: "live",
    },
  };
}

async function loadOffchainMetadata(uri: string | null): Promise<{
  description: string | null;
  loaded: boolean;
}> {
  if (!uri || !isAllowedMetadataUrl(uri)) {
    return { description: null, loaded: false };
  }
  const result = await fetchJson<Record<string, unknown>>(uri, {
    timeoutMs: 6_000,
    retries: 0,
    revalidateSeconds: 600,
  });
  if (!result.ok || !result.data) return { description: null, loaded: false };

  const description = result.data.description;
  if (typeof description !== "string" || description.trim().length === 0) {
    return { description: null, loaded: true };
  }
  return { description: description.trim().slice(0, 4_000), loaded: true };
}

async function loadHolders(mint: string): Promise<HolderConcentration> {
  const largest = await rpc<{ value: Array<{ amount: string }> }>(
    "getTokenLargestAccounts",
    [mint, { commitment: "confirmed" }],
    7_000,
  );

  const supply = await rpc<{ value: { amount: string; decimals: number } }>(
    "getTokenSupply",
    [mint, { commitment: "confirmed" }],
    7_000,
  );

  const decimals = supply.ok && supply.data ? supply.data.value.decimals : null;
  const supplyRaw = supply.ok && supply.data ? supply.data.value.amount : null;

  if (!largest.ok || !largest.data) {
    return {
      state: "unavailable",
      topShare: null,
      accountsInspected: 0,
      supplyRaw,
      decimals,
      reason: largest.error ?? "getTokenLargestAccounts unavailable",
    };
  }

  const accounts = largest.data.value ?? [];
  if (accounts.length === 0 || !supplyRaw || BigInt(supplyRaw) === 0n) {
    return {
      state: "unavailable",
      topShare: null,
      accountsInspected: accounts.length,
      supplyRaw,
      decimals,
      reason: "no largest-holder accounts or zero supply reported",
    };
  }

  let total = 0n;
  for (const account of accounts) {
    try {
      total += BigInt(account.amount);
    } catch {
      // Skip an unparsable amount rather than discarding the whole reading.
    }
  }

  const topShare = Number((total * 10_000n) / BigInt(supplyRaw)) / 10_000;

  return {
    state: "ok",
    topShare: Math.max(0, Math.min(1, topShare)),
    accountsInspected: accounts.length,
    supplyRaw,
    decimals,
  };
}

/* ------------------------------------------------------------------ *
 * DexScreener
 * ------------------------------------------------------------------ */

interface DexPair {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  labels?: string[];
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string | number;
  priceChange?: { h24?: number | null };
  liquidity?: { usd?: number; base?: number; quote?: number };
  volume?: { h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  pairCreatedAt?: number;
  info?: { riskLabels?: string[] };
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeDexPairs(raw: DexPair[], mint: string): MarketPair[] {
  const pairs: MarketPair[] = [];

  for (const pair of raw) {
    if (pair.chainId !== "solana") continue;
    if (!pair.baseToken?.address) continue;

    // Keep only pairs where our mint is the base or the quote side.
    const isBase = pair.baseToken.address === mint;
    const isQuote = pair.quoteToken?.address === mint;
    if (!isBase && !isQuote) continue;

    pairs.push({
      pairAddress: pair.pairAddress ?? "",
      dex: (pair.dexId ?? "other") as DexId,
      label: pair.labels?.[0] ?? null,
      url: pair.url ?? "",
      priceUsd: num(pair.priceUsd),
      priceChange24h: num(pair.priceChange?.h24),
      liquidity: {
        usd: num(pair.liquidity?.usd) ?? 0,
        base: num(pair.liquidity?.base) ?? 0,
        quote: num(pair.liquidity?.quote) ?? 0,
      },
      volume24h: num(pair.volume?.h24) ?? 0,
      txns24h: (num(pair.txns?.h24?.buys) ?? 0) + (num(pair.txns?.h24?.sells) ?? 0),
      createdAt:
        typeof pair.pairCreatedAt === "number" && pair.pairCreatedAt > 0
          ? new Date(pair.pairCreatedAt).toISOString()
          : null,
      baseToken: {
        address: pair.baseToken.address,
        name: pair.baseToken.name ?? null,
        symbol: pair.baseToken.symbol ?? null,
      },
      quoteToken: {
        address: pair.quoteToken?.address ?? "",
        name: pair.quoteToken?.name ?? null,
        symbol: pair.quoteToken?.symbol ?? null,
      },
      riskLabels: pair.info?.riskLabels ?? [],
    });
  }

  pairs.sort((a, b) => b.liquidity.usd - a.liquidity.usd);
  return pairs;
}

async function loadDexScreener(mint: string): Promise<{
  pairs: MarketPair[];
  attribution: SourceAttribution;
  priceUsd: number | null;
}> {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${mint}`;
  const result = await fetchJson<{ pairs?: DexPair[] | null }>(url, {
    timeoutMs: 8_000,
    retries: 1,
    revalidateSeconds: 120,
  });

  if (!result.ok) {
    return {
      pairs: [],
      attribution: attribution(
        SOURCE_INFO.dexscreener.id,
        SOURCE_INFO.dexscreener.label,
        SOURCE_INFO.dexscreener.homepage,
        url,
        { status: "fallback", fetchedAt: result.fetchedAt, error: result.error },
      ),
      priceUsd: null,
    };
  }

  const pairs = normalizeDexPairs(result.data.pairs ?? [], mint);

  return {
    pairs,
    attribution: {
      ...SOURCE_INFO.dexscreener,
      endpoint: url,
      fetchedAt: result.fetchedAt,
      status: pairs.length > 0 ? "live" : "live",
    },
    priceUsd: pairs.find((p) => p.priceUsd !== null)?.priceUsd ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Jupiter
 * ------------------------------------------------------------------ */

async function loadJupiter(
  mint: string,
): Promise<{ priceUsd: number | null; attribution: SourceAttribution }> {
  const url = `https://lite-api.jup.ag/price/v3?ids=${mint}`;
  const result = await fetchJson<Record<string, { usdPrice?: string | number }>>(url, {
    timeoutMs: 6_000,
    retries: 1,
    revalidateSeconds: 120,
  });

  if (!result.ok) {
    return {
      priceUsd: null,
      attribution: attribution(
        SOURCE_INFO.jupiter.id,
        SOURCE_INFO.jupiter.label,
        SOURCE_INFO.jupiter.homepage,
        url,
        { status: "fallback", fetchedAt: result.fetchedAt, error: result.error },
      ),
    };
  }

  const entry = result.data[mint];
  return {
    priceUsd: num(entry?.usdPrice),
    attribution: {
      ...SOURCE_INFO.jupiter,
      endpoint: url,
      fetchedAt: result.fetchedAt,
      status: entry ? "live" : "fallback",
      ...(entry ? {} : { note: "mint not priced by this source" }),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

function aggregateAge(pairs: MarketPair[]): { oldestPairAt: string | null; ageDays: number | null } {
  const timestamps = pairs
    .map((p) => p.createdAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) return { oldestPairAt: null, ageDays: null };

  const oldest = Math.min(...timestamps);
  const ageDays = (Date.now() - oldest) / 86_400_000;
  return {
    oldestPairAt: new Date(oldest).toISOString(),
    ageDays: ageDays > 0 ? ageDays : 0,
  };
}

export interface LoadOptions {
  /**
   * When true, a total upstream failure yields the sealed sample fixture with
   * `status: "fallback"`. Used by the build and by the demo route.
   */
  allowFallback?: boolean;
}

export async function loadMintFacts(mint: string, options: LoadOptions = {}): Promise<MintFacts> {
  const { allowFallback = true } = options;

  const [metadataResult, dexResult, jupiterResult, holders] = await Promise.all([
    loadMetadata(mint),
    loadDexScreener(mint),
    loadJupiter(mint),
    loadHolders(mint),
  ]);

  const metadata = metadataResult.metadata;
  const pairs = dexResult.pairs;

  const allSourcesDown =
    metadata === null &&
    pairs.length === 0 &&
    jupiterResult.priceUsd === null;

  if (allSourcesDown && allowFallback && FALLBACK_FIXTURES[mint]) {
    return fallbackFacts(mint, metadataResult.note ?? "all live sources unavailable");
  }

  const liquidityUsd = pairs.reduce((sum, pair) => sum + (pair.liquidity.usd || 0), 0);
  const volume24h = pairs.reduce((sum, pair) => sum + (pair.volume24h || 0), 0);
  const dexIds = new Set(pairs.map((p) => p.dex));
  const { oldestPairAt, ageDays } = aggregateAge(pairs);

  const dexPrice = dexResult.priceUsd;
  const jupPrice = jupiterResult.priceUsd;
  let divergence: number | null = null;
  if (dexPrice !== null && jupPrice !== null && dexPrice > 0) {
    divergence = Math.abs(dexPrice - jupPrice) / dexPrice;
  }

  const sources: SourceAttribution[] = [
    ...(metadataResult.attribution
      ? [
          metadataResult.attribution,
          attribution(
            SOURCE_INFO.solanaRpc.id,
            SOURCE_INFO.solanaRpc.label,
            SOURCE_INFO.solanaRpc.homepage,
            `${RPC_ENDPOINT} # getTokenLargestAccounts + getTokenSupply`,
            {
              status: holders.state === "ok" ? "live" : "fallback",
              fetchedAt: new Date().toISOString(),
              ...(holders.state === "ok" ? {} : { error: holders.reason ?? "unavailable" }),
            },
          ),
        ]
      : [
          attribution(
            SOURCE_INFO.solanaRpc.id,
            SOURCE_INFO.solanaRpc.label,
            SOURCE_INFO.solanaRpc.homepage,
            `${RPC_ENDPOINT} # getAccountInfo`,
            {
              status: "fallback",
              fetchedAt: new Date().toISOString(),
              error: metadataResult.note ?? "unavailable",
            },
          ),
        ]),
    dexResult.attribution,
    jupiterResult.attribution,
  ];

  return {
    mint,
    validAddress: true,
    metadata,
    pairs,
    liquidityUsd,
    volume24h,
    priceUsd: dexPrice ?? jupPrice,
    priceChange24h: pairs.find((p) => p.priceChange24h !== null)?.priceChange24h ?? null,
    oldestPairAt,
    ageDays,
    pairCount: pairs.length,
    dexCount: dexIds.size,
    holders,
    corroboration: {
      source: "jupiter",
      priceUsd: jupPrice,
      divergence,
    },
    sources,
  };
}

/** Exposed so `/api/health` can prove the RPC methods this app depends on exist. */
export const RPC_DEPENDENCY_METHODS = RPC_METHODS;