/**
 * Minimal Solana address math, without a heavyweight SDK.
 *
 * Only two things are needed to read a token's identity off-chain:
 *
 *  1. `findProgramAddress` — derive the Metaplex metadata account for a mint.
 *  2. base58 — the account address encoding Solana uses everywhere.
 *
 * Both are implemented here directly rather than pulled from a wallet SDK,
 * because the registry only ever *reads* public state and never signs anything.
 * The ed25519 curve check is the part that matters: a program-derived address
 * is by definition one that is **not** a valid curve point.
 */

import { createHash } from "node:crypto";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_MAP: Record<string, number> = {};
for (let i = 0; i < BASE58_ALPHABET.length; i += 1) {
  BASE58_MAP[BASE58_ALPHABET[i]] = i;
}

/** Encode bytes as base58. */
export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (let k = 0; bytes[k] === 0 && k < bytes.length - 1; k += 1) out += "1";
  for (let i = digits.length - 1; i >= 0; i -= 1) out += BASE58_ALPHABET[digits[i]];
  return out;
}

/** Decode base58 to bytes. Returns `null` on any invalid character. */
export function base58Decode(input: string): Uint8Array | null {
  if (input.length === 0) return null;
  const bytes: number[] = [0];
  for (const char of input) {
    const value = BASE58_MAP[char];
    if (value === undefined) return null;
    let carry = value;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let k = 0; input[k] === "1" && k < input.length - 1; k += 1) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

/** True when the string decodes to exactly 32 bytes, i.e. looks like an address. */
export function isValidSolanaAddress(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length < 32 || trimmed.length > 44) return false;
  const decoded = base58Decode(trimmed);
  return decoded !== null && decoded.length === 32;
}

/* ------------------------------------------------------------------ *
 * ed25519 curve membership
 * ------------------------------------------------------------------ */

const P = (1n << 255n) - 19n;
const D = BigInt(
  37095705934669439343138083508754565189542113879843219016388785533085940283555n,
);
const SQRT_M1 =
  19681161376707505956807079304988542015446066515923890162744021073123829784752n;

function mod(a: bigint, m: bigint = P): bigint {
  const result = a % m;
  return result < 0n ? result + m : result;
}

function powMod(base: bigint, exponent: bigint, m: bigint = P): bigint {
  let result = 1n;
  let b = mod(base, m);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

/**
 * True when the 32 bytes are a valid compressed Edwards point.
 *
 * A compressed point stores `y` little-endian in the low 255 bits, with the
 * high bit carrying the sign of `x`. A coordinate `x` exists only if
 * `x^2 = (y^2 - 1) / (d*y^2 + 1)` has a square root modulo p.
 */
export function isOnCurve(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) return false;

  let y = 0n;
  for (let i = 31; i >= 0; i -= 1) {
    y = (y << 8n) | BigInt(bytes[i]);
  }
  // Clear the sign bit.
  y &= (1n << 255n) - 1n;

  if (y >= P) return false;

  const y2 = mod(y * y);
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);

  if (v === 0n) return false;

  const x = powMod(mod(u * powMod(v, P - 2n)), (P + 3n) / 8n);
  const vx2 = mod(v * x * x);

  if (vx2 === mod(u)) return true;

  // The other possible root is x * sqrt(-1).
  const x2 = mod(x * SQRT_M1);
  if (mod(v * x2 * x2) === mod(u)) return true;

  return false;
}

/* ------------------------------------------------------------------ *
 * Program-derived addresses
 * ------------------------------------------------------------------ */

export interface ProgramAddress {
  address: string;
  bump: number;
}

/**
 * Derive a program-derived address.
 *
 * `seeds` are hashed in order, then the bump byte, the program id and the
 * literal `ProgramDerivedAddress` marker. The scan starts at bump 255 and walks
 * down; the first candidate that is **not** on the curve wins.
 */
export function findProgramAddress(seeds: Uint8Array[], programId: Uint8Array): ProgramAddress {
  if (seeds.length > 16) {
    throw new Error(`findProgramAddress: at most 16 seeds are supported, received ${seeds.length}`);
  }
  if (programId.length !== 32) {
    throw new Error("findProgramAddress: program id must be 32 bytes");
  }

  const marker = Buffer.from("ProgramDerivedAddress", "utf8");

  for (let bump = 255; bump >= 0; bump -= 1) {
    const parts: Uint8Array[] = [...seeds, Uint8Array.of(bump), programId];
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0) + marker.length;
    const buffer = new Uint8Array(totalLength);

    let offset = 0;
    for (const part of parts) {
      buffer.set(part, offset);
      offset += part.length;
    }
    buffer.set(marker, offset);

    const hash = new Uint8Array(createHash("sha256").update(buffer).digest());
    if (!isOnCurve(hash)) {
      return { address: base58Encode(hash), bump };
    }
  }

  throw new Error("findProgramAddress: no viable address found");
}

/** Metaplex Token Metadata program id. */
export const TOKEN_METADATA_PROGRAM_ID = base58Decode(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
)!;

/** Derive the metadata account for a mint. */
export function deriveMetadataAddress(mint: string): { address: string; bump: number } {
  const mintBytes = base58Decode(mint);
  if (!mintBytes || mintBytes.length !== 32) {
    throw new Error(`deriveMetadataAddress: invalid mint address "${mint}"`);
  }
  return findProgramAddress(
    [Buffer.from("metadata", "utf8"), TOKEN_METADATA_PROGRAM_ID, mintBytes],
    TOKEN_METADATA_PROGRAM_ID,
  );
}