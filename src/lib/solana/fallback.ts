/**
 * Sealed offline sample.
 *
 * These fixtures exist so the first paint and `next build` never break when the
 * chain or the indexers are unreachable. Three rules keep them honest:
 *
 *  1. Every field sourced here carries `status: "fallback"` and a `note`, and the
 *     UI renders that note instead of hiding it.
 *  2. Only mints that existed long before this build are included, so the
 *     numbers are not a moving target.
 *  3. User-created records are never merged with, replaced by, or reconciled
 *     against this data. Fallback affects what a *live read* returns, never what
 *     the registry stores.
 */

import type { MintFacts } from "../types";
import type { MarketPair } from "../types";

const FIXTURE_CAPTURED_AT = "2026-09-20T00:00:00.000Z";

function pair(overrides: Partial<MarketPair> & Pick<MarketPair, "pairAddress" | "baseToken" | "liquidity">): MarketPair {
  return {
    dex: "raydium",
    label: null,
    url: "https://dexscreener.com/solana",
    priceUsd: null,
    priceChange24h: null,
    volume24h: 0,
    txns24h: 0,
    createdAt: null,
    quoteToken: { address: "So11111111111111111111111111111111111111112", name: "Wrapped SOL", symbol: "WSOL" },
    riskLabels: [],
    ...overrides,
  };
}

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";

const FIXTURES: Record<string, MintFacts> = {
  [USDC]: {
    mint: USDC,
    validAddress: true,
    metadata: {
      mint: USDC,
      metadataAddress: "5x38Kp4hvdomTCnCrAny4UtMUt5rQBdB6px2K1Ui45Wq",
      updateAuthority: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      name: "USD Coin",
      symbol: "USDC",
      uri: "https://www.circle.com/usdc",
      description:
        "USD Coin (USDC) is a fully reserved digital dollar issued by regulated financial technology company Circle. USDC is designed to be a stable, transparent and reliable digital dollar pegged one-to-one with the US dollar.",
      offchainLoaded: true,
      primarySaleHappened: true,
      isMutable: false,
    },
    pairs: [
      pair({
        pairAddress: "2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv",
        label: "3LP",
        liquidity: { usd: 48_260_716, base: 24_130_358, quote: 24_130_358 },
        volume24h: 91_400_000,
        txns24h: 41_200,
        priceUsd: 1.0,
        createdAt: "2024-06-05T08:55:25.527Z",
        baseToken: { address: USDC, name: "USD Coin", symbol: "USDC" },
      }),
    ],
    liquidityUsd: 48_260_716,
    volume24h: 91_400_000,
    priceUsd: 1.0,
    priceChange24h: 0.0001,
    oldestPairAt: "2024-06-05T08:55:25.527Z",
    ageDays: 842,
    pairCount: 1,
    dexCount: 1,
    holders: {
      state: "unavailable",
      topShare: null,
      accountsInspected: 0,
      supplyRaw: null,
      decimals: 6,
      reason: "sealed sample carries no holder reading",
    },
    corroboration: { source: "jupiter", priceUsd: 0.9999, divergence: 0.0001 },
    sources: [
      {
        id: "sealed-sample",
        label: "Sealed offline sample",
        homepage: "https://github.com/aniruddhaadak80/mintline",
        endpoint: "src/lib/solana/fallback.ts",
        fetchedAt: FIXTURE_CAPTURED_AT,
        status: "fallback",
        note: `Sealed sample captured ${FIXTURE_CAPTURED_AT}. Not live data.`,
      },
    ],
  },

  [BONK]: {
    mint: BONK,
    validAddress: true,
    metadata: {
      mint: BONK,
      metadataAddress: "FDZZbyY9XGpL3CNKUZxLk3wFTTQYL3TkDiDzqxrizcPN",
      updateAuthority: null,
      name: "Bonk",
      symbol: "BONK",
      uri: null,
      description:
        "Bonk is a community-driven meme coin on Solana and the mascot of the bonk.fun launchpad. It bills itself as the first Solana meme coin and distributes supply widely through airdrops.",
      offchainLoaded: true,
      primarySaleHappened: true,
      isMutable: false,
    },
    pairs: [
      pair({
        pairAddress: "8Q5MK5gmqU4wPMqvUjbAcx7L4FmwvcCLqvU4EGmCJQvJ",
        label: "CLMM",
        liquidity: { usd: 3_140_000, base: 1_570_000, quote: 1_570_000 },
        volume24h: 21_300_000,
        txns24h: 18_900,
        priceUsd: 0.0000182,
        createdAt: "2022-12-24T00:00:00.000Z",
        baseToken: { address: BONK, name: "Bonk", symbol: "BONK" },
      }),
    ],
    liquidityUsd: 3_140_000,
    volume24h: 21_300_000,
    priceUsd: 0.0000182,
    priceChange24h: -0.041,
    oldestPairAt: "2022-12-24T00:00:00.000Z",
    ageDays: 1_348,
    pairCount: 1,
    dexCount: 1,
    holders: {
      state: "unavailable",
      topShare: null,
      accountsInspected: 0,
      supplyRaw: null,
      decimals: 5,
      reason: "sealed sample carries no holder reading",
    },
    corroboration: { source: "jupiter", priceUsd: 0.0000181, divergence: 0.0055 },
    sources: [
      {
        id: "sealed-sample",
        label: "Sealed offline sample",
        homepage: "https://github.com/aniruddhaadak80/mintline",
        endpoint: "src/lib/solana/fallback.ts",
        fetchedAt: FIXTURE_CAPTURED_AT,
        status: "fallback",
        note: `Sealed sample captured ${FIXTURE_CAPTURED_AT}. Not live data.`,
      },
    ],
  },

  [WIF]: {
    mint: WIF,
    validAddress: true,
    metadata: {
      mint: WIF,
      metadataAddress: null,
      updateAuthority: null,
      name: "dogwifhat",
      symbol: "WIF",
      uri: null,
      description:
        "dogwifhat (WIF) is a Solana meme coin featuring a Shiba Inu wearing a knitted hat, described by its community as a community-driven meme coin with no utility and no promises.",
      offchainLoaded: true,
      primarySaleHappened: true,
      isMutable: false,
    },
    pairs: [
      pair({
        pairAddress: "6Q6cF3fJLZbYbXjL8gW3vqK1sNnT9pQ2rT7bV4cX1mY",
        label: "CLMM",
        liquidity: { usd: 8_900_000, base: 4_450_000, quote: 4_450_000 },
        volume24h: 44_100_000,
        txns24h: 22_400,
        priceUsd: 1.42,
        createdAt: "2023-11-20T00:00:00.000Z",
        baseToken: { address: WIF, name: "dogwifhat", symbol: "WIF" },
      }),
    ],
    liquidityUsd: 8_900_000,
    volume24h: 44_100_000,
    priceUsd: 1.42,
    priceChange24h: 0.072,
    oldestPairAt: "2023-11-20T00:00:00.000Z",
    ageDays: 1017,
    pairCount: 1,
    dexCount: 1,
    holders: {
      state: "unavailable",
      topShare: null,
      accountsInspected: 0,
      supplyRaw: null,
      decimals: 6,
      reason: "sealed sample carries no holder reading",
    },
    corroboration: { source: "jupiter", priceUsd: 1.4198, divergence: 0.0001 },
    sources: [
      {
        id: "sealed-sample",
        label: "Sealed offline sample",
        homepage: "https://github.com/aniruddhaadak80/mintline",
        endpoint: "src/lib/solana/fallback.ts",
        fetchedAt: FIXTURE_CAPTURED_AT,
        status: "fallback",
        note: `Sealed sample captured ${FIXTURE_CAPTURED_AT}. Not live data.`,
      },
    ],
  },
};

export const FALLBACK_FIXTURES = FIXTURES;

/** Mints offered as one-click examples on the landing page and in `/assay`. */
export const SAMPLE_MINTS = [
  { mint: USDC, label: "USD Coin", symbol: "USDC" },
  { mint: BONK, label: "Bonk", symbol: "BONK" },
  { mint: WIF, label: "dogwifhat", symbol: "WIF" },
];

export function isSampleMint(mint: string): boolean {
  return Object.prototype.hasOwnProperty.call(FIXTURES, mint);
}

export function fallbackFacts(mint: string, reason: string): MintFacts {
  const fixture = FIXTURES[mint];
  if (!fixture) {
    throw new Error(`no sealed sample for mint ${mint}`);
  }
  return {
    ...fixture,
    sources: fixture.sources.map((source) => ({
      ...source,
      status: "fallback" as const,
      note: `Live sources unreachable (${reason}). Showing the sealed sample captured ${FIXTURE_CAPTURED_AT}. Not live data.`,
    })),
  };
}

export const FALLBACK_CAPTURED_AT = FIXTURE_CAPTURED_AT;