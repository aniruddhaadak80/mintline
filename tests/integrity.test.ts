import { describe, expect, it } from "vitest";
import { canonicalJson, sha384Hex } from "@/lib/integrity/canonical";
import { buildEvent, expectedSeal, GENESIS_SEAL, GENESIS_SALT, replayChain } from "@/lib/integrity/chain";
import type { ChainEvent } from "@/lib/types";

/**
 * These are the tests that matter most for an integrity claim.
 *
 * `known vectors` pins the exact seal values, so a refactor that changes how a
 * chain is hashed fails loudly instead of silently invalidating every chain ever
 * written. The vectors were produced by this implementation and are asserted
 * byte-for-byte.
 */

const CREATED = "2026-01-01T00:00:00.000Z";

function makeEvent(seq: number, prevSeal: string, extra: Record<string, unknown> = {}): ChainEvent {
  return buildEvent({
    seq,
    originId: "o_test",
    eventType: "origin.registered",
    payload: { name: "Fixture", mint: "So11111111111111111111111111111111111111112", ...extra },
    prevSeal,
    createdAt: CREATED,
  });
}

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("is stable regardless of insertion order", () => {
    const first = canonicalJson({ z: 1, m: { q: 2, b: 3 }, a: 4 });
    const second = canonicalJson({ a: 4, m: { b: 3, q: 2 }, z: 1 });
    expect(first).toBe(second);
  });

  it("preserves array order because order is meaningful", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("drops undefined members", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("normalises negative zero so it hashes like zero", () => {
    expect(canonicalJson({ v: -0 })).toBe('{"v":0}');
    expect(sha384Hex(canonicalJson({ v: -0 }))).toBe(sha384Hex(canonicalJson({ v: 0 })));
  });

  it("serialises dates as ISO-8601 UTC", () => {
    expect(canonicalJson({ at: new Date("2026-03-04T05:06:07.008Z") })).toBe(
      '{"at":"2026-03-04T05:06:07.008Z"}',
    );
  });

  it("rejects non-finite numbers rather than emitting null", () => {
    expect(() => canonicalJson({ v: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson({ v: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
  });

  it("normalises bigints to strings so they stay canonical", () => {
    expect(canonicalJson({ v: 10n })).toBe('{"v":"10"}');
  });

  it("throws on a function member", () => {
    expect(() => canonicalJson({ v: () => 1 })).toThrow(/unsupported type/);
  });
});

describe("genesis and known vectors", () => {
  it("derives the genesis seal from the salt", () => {
    expect(GENESIS_SEAL).toBe(sha384Hex(GENESIS_SALT));
    // Pinned vector. Changing the salt or the digest breaks every chain ever
    // written, so this assertion is the tripwire.
    expect(GENESIS_SEAL).toBe(
      "8d9fb932a27d3851dc94fd9272980918345a9deb1427fe7b5eedd2df40122cdf4224c9c5fcaf1de0809f04decd861123",
    );
  });

  it("produces a stable first seal", () => {
    const event = makeEvent(1, GENESIS_SEAL);
    expect(event.canonical).toBe(
      '{"createdAt":"2026-01-01T00:00:00.000Z","eventType":"origin.registered","originId":"o_test","payload":{"mint":"So11111111111111111111111111111111111111112","name":"Fixture"},"seq":1}',
    );
    expect(event.seal).toBe(sha384Hex(GENESIS_SEAL + event.canonical));
    expect(event.seal).toMatch(/^[0-9a-f]{96}$/);
  });

  it("produces identical output for identical input", () => {
    expect(makeEvent(1, GENESIS_SEAL).seal).toBe(makeEvent(1, GENESIS_SEAL).seal);
  });
});

describe("seal chain", () => {
  function buildChain(length: number): ChainEvent[] {
    const events: ChainEvent[] = [];
    let prev = GENESIS_SEAL;
    for (let seq = 1; seq <= length; seq += 1) {
      const event = makeEvent(seq, prev, { seq });
      events.push(event);
      prev = event.seal;
    }
    return events;
  }

  it("links each event to its predecessor", () => {
    const chain = buildChain(4);
    for (let i = 1; i < chain.length; i += 1) {
      expect(chain[i].prevSeal).toBe(chain[i - 1].seal);
    }
  });

  it("replays a clean chain", () => {
    const chain = buildChain(5);
    const result = replayChain("o_test", chain);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(5);
    expect(result.brokenAtSeq).toBeNull();
    expect(result.headSeal).toBe(chain[chain.length - 1].seal);
  });

  it("replays an empty chain without claiming success on events", () => {
    const result = replayChain("o_test", []);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(0);
    expect(result.headSeal).toBeNull();
  });

  it("detects a tampered payload and names the first bad seq", () => {
    const chain = buildChain(4);
    chain[1] = { ...chain[1], payload: { ...chain[1].payload, name: "Tampered" } };

    const result = replayChain("o_test", chain);
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(2);
    expect(result.brokenReason).toMatch(/canonical payload/);
    expect(result.checked).toBe(1);
  });

  it("detects a rewritten seal", () => {
    const chain = buildChain(3);
    chain[2] = { ...chain[2], seal: "f".repeat(96) };

    const result = replayChain("o_test", chain);
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(3);
    expect(result.brokenReason).toMatch(/seal mismatch/);
  });

  it("detects a removed event via the sequence gap", () => {
    const chain = buildChain(4).filter((event) => event.seq !== 2);

    const result = replayChain("o_test", chain);
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(3);
    expect(result.brokenReason).toMatch(/sequence gap/);
  });

  it("normalises storage order rather than flagging it as tampering", () => {
    // `seq` is the canonical ordering, so a shuffled read order is not a
    // tamper signal. Content mutation is, and is covered above.
    const chain = buildChain(3);
    const shuffled = [chain[2], chain[0], chain[1]];
    expect(replayChain("o_test", shuffled).ok).toBe(true);
  });

  it("still catches a reordering that also rewrites the payloads", () => {
    const chain = buildChain(3);
    // Swap the payloads but keep the stored seals: now the canonical form of
    // each row no longer reproduces.
    const swapped = [
      chain[0],
      { ...chain[2], payload: chain[1].payload },
      { ...chain[1], payload: chain[2].payload },
    ];
    const result = replayChain("o_test", swapped);
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(2);
  });

  it("rejects a chain that starts from a foreign genesis", () => {
    const chain = buildChain(2);
    const forged = [{ ...chain[0], prevSeal: "a".repeat(96) }, chain[1]];

    const result = replayChain("o_test", forged);
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(1);
    expect(result.brokenReason).toMatch(/prevSeal mismatch/);
  });

  it("flags a chain whose first sequence is not 1", () => {
    const chain = buildChain(2);
    const shifted = [{ ...chain[0], seq: 7 }, chain[1]];

    const result = replayChain("o_test", shifted);
    expect(result.ok).toBe(false);
    expect(result.brokenReason).toMatch(/sequence gap/);
  });

  it("sorts out-of-order events before replaying", () => {
    const chain = buildChain(3);
    const shuffled = [chain[2], chain[0], chain[1]];
    expect(replayChain("o_test", shuffled).ok).toBe(true);
  });

  it("exposes expectedSeal as the single recomputation path", () => {
    const event = makeEvent(1, GENESIS_SEAL);
    expect(expectedSeal(event.prevSeal, event.canonical)).toBe(event.seal);
  });
});