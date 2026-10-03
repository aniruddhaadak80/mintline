/**
 * Per-entity audit chain.
 *
 * The rule, stated once:
 *
 *     genesis    = SHA-384(UTF-8(GENESIS_SALT))
 *     seal(n)    = SHA-384(UTF-8(seal(n-1)) || canonicalJson(event(n)))
 *
 * with `seal(0)` treated as `genesis`. Because every seal commits to the
 * previous one, altering or removing any earlier event invalidates every later
 * seal, and `replay` reports the first sequence number that fails.
 *
 * This is a deliberately small append-only ledger: no token, no gas, no wallet.
 * It exists so that a claim about a token's origin can be checked by anyone,
 * later, without trusting the registry that stored it.
 */

import { canonicalJson, sha384Hex } from "./canonical";
import type { ChainEvent, ReplayResult } from "../types";

export const GENESIS_SALT = "mintline/genesis/v1";

/** The `prevSeal` of the first event in every chain. */
export const GENESIS_SEAL = sha384Hex(GENESIS_SALT);

export type AuditEventType =
  | "origin.registered"
  | "origin.assayed"
  | "origin.verdict_recorded"
  | "origin.updated"
  | "origin.retired"
  | "origin.restored";

export interface AuditEventInput {
  seq: number;
  originId: string;
  eventType: AuditEventType | string;
  payload: Record<string, unknown>;
  prevSeal: string;
  createdAt: string;
}

/**
 * Compute the seal for one event.
 *
 * Concatenation is over UTF-8 bytes of the previous seal hex and the canonical
 * JSON. Both operands are fixed-width or fully determined, so no delimiter is
 * needed and none is used.
 */
export interface BuildEventResult {
  canonical: string;
  seal: string;
}

/**
 * Build the canonical form and seal of an event. Pure: it performs no I/O, so
 * tests can produce known vectors without a database.
 */
export function buildEvent(input: AuditEventInput): BuildEventResult & ChainEvent {
  const { seq, originId, eventType, payload, prevSeal, createdAt } = input;

  // `seq` and `createdAt` live inside the hashed payload so that reordering or
  // retimestamping an event is detectable.
  const hashedBody = {
    eventType,
    originId,
    payload,
    seq,
    createdAt,
  };

  const canonical = canonicalJson(hashedBody);
  const seal = sha384Hex(prevSeal + canonical);

  return {
    seq,
    originId,
    eventType,
    payload,
    canonical,
    prevSeal,
    seal,
    createdAt,
  };
}

/** The seal a chain expects at `seq` given a stored `prevSeal`. */
export function expectedSeal(prevSeal: string, canonical: string): string {
  return sha384Hex(prevSeal + canonical);
}

export interface VerifyOptions {
  /** Expected genesis, injectable so tests can prove a foreign genesis fails. */
  genesis?: string;
  /** When true, a chain that starts at a sequence other than 1 is a break. */
  requireStartAtOne?: boolean;
}

/**
 * Replay a stored chain and report the first broken link.
 *
 * `genesis` is not stored per row; it is recomputed, so a chain whose first
 * event does not descend from the real genesis is rejected at `seq === 1`.
 */
export function replayChain(
  originId: string,
  events: ChainEvent[],
  options: VerifyOptions = {},
): ReplayResult {
  const genesis = options.genesis ?? GENESIS_SEAL;
  const requireStartAtOne = options.requireStartAtOne ?? true;

  const base: ReplayResult = {
    originId,
    ok: true,
    checked: 0,
    genesis,
    headSeal: null,
    brokenAtSeq: null,
    brokenReason: null,
    events,
  };

  if (events.length === 0) {
    return base;
  }

  const ordered = [...events].sort((a, b) => a.seq - b.seq);

  let prevSeal = genesis;

  for (let index = 0; index < ordered.length; index += 1) {
    const event = ordered[index];
    const expectedSeq = index + 1;

    if (requireStartAtOne && event.seq !== expectedSeq) {
      return {
        ...base,
        checked: index,
        ok: false,
        headSeal: prevSeal,
        brokenAtSeq: event.seq,
        brokenReason: `sequence gap: expected seq ${expectedSeq}, found ${event.seq}`,
      };
    }

    if (event.prevSeal !== prevSeal) {
      return {
        ...base,
        checked: index,
        ok: false,
        headSeal: prevSeal,
        brokenAtSeq: event.seq,
        brokenReason: `prevSeal mismatch: expected ${prevSeal}, stored ${event.prevSeal}`,
      };
    }

    const recomputedCanonical = canonicalJson({
      eventType: event.eventType,
      originId: event.originId,
      payload: event.payload,
      seq: event.seq,
      createdAt: event.createdAt,
    });

    if (recomputedCanonical !== event.canonical) {
      return {
        ...base,
        checked: index,
        ok: false,
        headSeal: prevSeal,
        brokenAtSeq: event.seq,
        brokenReason: "canonical payload does not match the stored canonical form",
      };
    }

    const expected = expectedSeal(event.prevSeal, event.canonical);
    if (expected !== event.seal) {
      return {
        ...base,
        checked: index,
        ok: false,
        headSeal: prevSeal,
        brokenAtSeq: event.seq,
        brokenReason: `seal mismatch: expected ${expected}, stored ${event.seal}`,
      };
    }

    prevSeal = event.seal;
  }

  return {
    ...base,
    checked: ordered.length,
    headSeal: prevSeal,
    ok: true,
  };
}

/** Short, human-quotable form of a seal, used in the UI and the dossier. */
export function shortSeal(seal: string | null): string {
  if (!seal) return "—";
  return `${seal.slice(0, 8)}…${seal.slice(-6)}`;
}