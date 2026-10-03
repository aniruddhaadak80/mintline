/**
 * Metaplex `TokenMetadata` account decoder.
 *
 * Layout (little-endian, borsh), from the on-chain program:
 *
 * ```text
   0   u8            key                       4 == MetadataV1
 *   1   [32]          update_authority
 *  33   [32]          mint
 *  65   u32 + bytes   name
 *      u32 + bytes   symbol
 *      u32 + bytes   uri
 *      u16           seller_fee_basis_points
 *      u8 + [u32]    Option<Vec<Creator>>     32-byte key + 1-byte verified
 *      u8            primary_sale_happened
 *      u8            is_mutable
 * ```
 *
 * Only the fields the assay needs are decoded, but the creator vector is
 * walked correctly rather than skipped, because `is_mutable` sits behind it and
 * immutability is one of the completeness checks.
 */

import { base58Encode } from "./address";
import type { OnChainMetadata } from "../types";

export interface RawTokenMetadata {
  key: number;
  updateAuthority: string;
  mint: string;
  name: string | null;
  symbol: string | null;
  uri: string | null;
  sellerFeeBasisPoints: number | null;
  creators: Array<{ address: string; verified: boolean; share: number }>;
  primarySaleHappened: boolean | null;
  isMutable: boolean | null;
}

function readString(
  buffer: Buffer,
  cursor: { at: number },
): string | null {
  if (cursor.at + 4 > buffer.length) {
    cursor.at = buffer.length + 1; // poison: signals truncation
    return null;
  }
  const length = buffer.readUInt32LE(cursor.at);
  cursor.at += 4;
  if (length > 4096 || cursor.at + length > buffer.length) {
    cursor.at = buffer.length + 1;
    return null;
  }
  const value = buffer.subarray(cursor.at, cursor.at + length).toString("utf8");
  cursor.at += length;
  // Metaplex pads fixed-size string fields with NULs.
  const cleaned = value.replace(/\0+$/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Decode a base64 account payload.
 *
 * Returns `null` when the payload is too short, has the wrong program key, or
 * does not reference the expected mint. A wrong-mint payload is treated as a
 * decode failure rather than trusted, so a collision cannot be reported against
 * the wrong token.
 */
export function decodeTokenMetadata(
  accountBase64: string,
  expectedMint: string,
): RawTokenMetadata | null {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(accountBase64, "base64");
  } catch {
    return null;
  }

  if (buffer.length < 70) return null;

  const key = buffer.readUInt8(0);
  if (key !== 4) return null;

  const updateAuthority = base58Encode(new Uint8Array(buffer.subarray(1, 33)));
  const mint = base58Encode(new Uint8Array(buffer.subarray(33, 65)));
  if (mint !== expectedMint) return null;

  const cursor = { at: 65 };
  const name = readString(buffer, cursor);
  if (cursor.at > buffer.length) return null;
  const symbol = readString(buffer, cursor);
  if (cursor.at > buffer.length) return null;
  const uri = readString(buffer, cursor);
  if (cursor.at > buffer.length) return null;

  let sellerFeeBasisPoints: number | null = null;
  if (cursor.at + 2 <= buffer.length) {
    sellerFeeBasisPoints = buffer.readUInt16LE(cursor.at);
    cursor.at += 2;
  }

  const creators: RawTokenMetadata["creators"] = [];
  if (cursor.at < buffer.length) {
    const hasVector = buffer.readUInt8(cursor.at);
    cursor.at += 1;
    if (hasVector === 1 && cursor.at + 4 <= buffer.length) {
      const count = buffer.readUInt32LE(cursor.at);
      cursor.at += 4;
      // 33 bytes per creator; cap the walk so a malformed count cannot spin.
      const bounded = Math.min(count, 64);
      for (let i = 0; i < bounded; i += 1) {
        if (cursor.at + 33 > buffer.length) break;
        const address = base58Encode(new Uint8Array(buffer.subarray(cursor.at, cursor.at + 32)));
        const verified = buffer.readUInt8(cursor.at + 32) === 1;
        creators.push({ address, verified, share: 0 });
        cursor.at += 33;
      }
    }
  }

  let primarySaleHappened: boolean | null = null;
  if (cursor.at < buffer.length) {
    primarySaleHappened = buffer.readUInt8(cursor.at) === 1;
    cursor.at += 1;
  }
  let isMutable: boolean | null = null;
  if (cursor.at < buffer.length) {
    isMutable = buffer.readUInt8(cursor.at) === 1;
    cursor.at += 1;
  }

  return {
    key,
    updateAuthority,
    mint,
    name,
    symbol,
    uri,
    sellerFeeBasisPoints,
    creators,
    primarySaleHappened,
    isMutable,
  };
}

/**
 * Build the normalized metadata view.
 *
 * `description` comes from the off-chain JSON at `uri`, which is a separate,
 * separately-attributed fetch. When it has not been loaded, the field is
 * `null` and `offchainLoaded` is `false` — never an empty string standing in
 * for a missing description.
 */
export function toOnChainMetadata(
  raw: RawTokenMetadata,
  offchain: { description: string | null; loaded: boolean },
): OnChainMetadata {
  return {
    mint: raw.mint,
    metadataAddress: null,
    updateAuthority: raw.updateAuthority,
    name: raw.name,
    symbol: raw.symbol,
    uri: raw.uri,
    description: offchain.description,
    offchainLoaded: offchain.loaded,
    primarySaleHappened: raw.primarySaleHappened,
    isMutable: raw.isMutable,
  };
}

/** The identity text the collision search compares. */
export function identityTextFrom(metadata: OnChainMetadata): string {
  return [metadata.name, metadata.symbol, metadata.description]
    .filter((part): part is string => Boolean(part && part.trim().length > 0))
    .join(" ");
}