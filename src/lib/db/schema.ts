/**
 * Schema.
 *
 * Written to be identical on Postgres and PGlite: no `jsonb`, no `uuid`
 * defaults, no extensions. That keeps the embedded adapter a genuine peer of
 * production rather than a subset.
 *
 * `IF NOT EXISTS` everywhere, applied once per process, so first run is
 * idempotent and a redeploy against an existing database is a no-op.
 */

import type { SqlExecutor } from "./sql";

export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS sessions (
     id            TEXT PRIMARY KEY,
     created_at    TEXT NOT NULL,
     last_seen_at  TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS origins (
     id            TEXT PRIMARY KEY,
     session_id    TEXT NOT NULL,
     mint          TEXT NOT NULL,
     name          TEXT NOT NULL,
     symbol        TEXT,
     description   TEXT,
     claim_note    TEXT,
     claimed_at    TEXT NOT NULL,
     status        TEXT NOT NULL,
     assay         TEXT,
     score         REAL,
     chain_head    TEXT NOT NULL,
     event_count   INTEGER NOT NULL DEFAULT 0,
     share_token   TEXT,
     created_at    TEXT NOT NULL,
     updated_at    TEXT NOT NULL,
     deleted_at    TEXT
   )`,

  `CREATE INDEX IF NOT EXISTS origins_session_idx ON origins (session_id)`,
  `CREATE INDEX IF NOT EXISTS origins_mint_idx ON origins (mint)`,
  `CREATE INDEX IF NOT EXISTS origins_status_idx ON origins (status)`,

  `CREATE UNIQUE INDEX IF NOT EXISTS origins_share_token_idx
     ON origins (share_token) WHERE share_token IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS chain_events (
     origin_id   TEXT NOT NULL,
     seq         INTEGER NOT NULL,
     session_id  TEXT NOT NULL,
     event_type  TEXT NOT NULL,
     payload     TEXT NOT NULL,
     canonical   TEXT NOT NULL,
     prev_seal   TEXT NOT NULL,
     seal        TEXT NOT NULL,
     created_at  TEXT NOT NULL,
     PRIMARY KEY (origin_id, seq)
   )`,

  `CREATE INDEX IF NOT EXISTS chain_events_session_idx ON chain_events (session_id)`,
];

/**
 * Reference origins for a public registry.
 *
 * These are claims about well-known Solana assets, and they are clearly marked:
 * `session_id` is the fixed value `registry` rather than an anonymous visitor,
 * which keeps them visible to every session while never being editable or
 * deletable by one. Seed ids are prefixed `seed:` so they can never collide
 * with a generated origin id.
 */
export const SEED_SESSION_ID = "registry";

export interface SeedOrigin {
  id: string;
  mint: string;
  name: string;
  symbol: string;
  description: string;
  claimedAt: string;
  source: string;
}

export const SEED_ORIGINS: SeedOrigin[] = [
  {
    id: "seed:usdc",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    name: "USD Coin",
    symbol: "USDC",
    description:
      "USD Coin is a fully reserved digital dollar issued by Circle. The name and ticker have been in continuous use since 2018 and the origin is not contested.",
    claimedAt: "2024-06-05T08:55:25.527Z",
    source: "Metaplex metadata on Solana mainnet",
  },
  {
    id: "seed:bonk",
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    name: "Bonk",
    symbol: "BONK",
    description:
      "Bonk is the mascot coin of the bonk.fun launchpad on Solana and one of the first widely distributed Solana meme coins. The BONK ticker predates most launchpad listings that use the name.",
    claimedAt: "2022-12-24T00:00:00.000Z",
    source: "Metaplex metadata on Solana mainnet",
  },
  {
    id: "seed:dogwifhat",
    mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    name: "dogwifhat",
    symbol: "WIF",
    description:
      "dogwifhat is a Solana meme coin built around a Shiba Inu wearing a knitted hat, launched in late 2023. The name is distinctive and the origin is not contested.",
    claimedAt: "2023-11-20T00:00:00.000Z",
    source: "Metaplex metadata on Solana mainnet",
  },
  {
    id: "seed:raydium",
    mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
    name: "Raydium",
    symbol: "RAY",
    description:
      "Raydium is an automated market maker and launchpad native to Solana. RAY is its governance and utility token.",
    claimedAt: "2021-12-01T00:00:00.000Z",
    source: "Metaplex metadata on Solana mainnet",
  },
  {
    id: "seed:jupiter",
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    name: "Jupiter",
    symbol: "JUP",
    description:
      "Jupiter is a Solana liquidity aggregator and swap venue. JUP governs the protocol and is distributed to users of the aggregator.",
    claimedAt: "2024-01-31T00:00:00.000Z",
    source: "Metaplex metadata on Solana mainnet",
  },
];

let schemaReady: Promise<void> | null = null;

/** Apply the schema. Safe to call on every request. */
export async function ensureSchema(sql: SqlExecutor): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const statement of SCHEMA_STATEMENTS) {
        await sql.query(statement);
      }
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

/** Test hook: forget that the schema was applied. */
export function resetSchemaCache(): void {
  schemaReady = null;
}