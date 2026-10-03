/**
 * Canonical JSON.
 *
 * Rules, applied recursively:
 *  - object keys sorted by code unit
 *  - `undefined` members dropped
 *  - non-finite numbers rejected (they have no canonical form)
 *  - `Date` serialized as ISO-8601 UTC with milliseconds
 *  - arrays keep their order (order is meaningful in an audit payload)
 *
 * The output is byte-stable, which is what makes a seal reproducible on a
 * different machine.
 */

import { createHash } from "node:crypto";

function canonicalize(value: unknown, path: string): unknown {
  if (value === null) return null;

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`canonicalJson: non-finite number at ${path || "<root>"}`);
    }
    // -0 and 0 must hash identically.
    return value === 0 ? 0 : value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source)
      .filter((key) => source[key] !== undefined)
      .sort();
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      out[key] = canonicalize(source[key], path ? `${path}.${key}` : key);
    }
    return out;
  }

  if (typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`canonicalJson: unsupported type at ${path || "<root>"}`);
  }

  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, ""));
}

/** SHA-384 of the UTF-8 bytes of `input`, lowercase hex. */
export function sha384Hex(input: string): string {
  return createHash("sha384").update(input, "utf8").digest("hex");
}