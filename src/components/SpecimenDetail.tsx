"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FactorBars, NeighborList, ScoreStamp, shortSeal } from "./AssayPress";
import { SITE } from "@/lib/config";
import type { ChainEvent, OriginRecord, ReplayResult } from "@/lib/types";

type Tab = "evidence" | "chain";

/**
 * The specimen detail view.
 *
 * Every control here hits a real endpoint: verdict recording, re-assay, share
 * issuance, dossier export and soft retirement. The chain tab replays from the
 * stored events and reports the first broken link if there is one.
 */
export function SpecimenDetail({ initialOrigin }: { initialOrigin: OriginRecord }) {
  const router = useRouter();

  const [origin, setOrigin] = useState(initialOrigin);
  const [tab, setTab] = useState<Tab>("evidence");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [note, setNote] = useState(initialOrigin.claimNote ?? "");
  const [events, setEvents] = useState<ChainEvent[] | null>(null);
  const [replay, setReplay] = useState<ReplayResult | null>(null);
  const [shareUrlOverride, setShareUrlOverride] = useState<string | null | undefined>(undefined);

  const readOnly = origin.sessionId === "registry";

  // Derived from the record, not synchronised in an effect. `SITE.liveUrl` is
  // the canonical host on both server and client, so no `window` access is
  // needed. An override lets the share tool report a freshly issued token.
  const shareUrl =
    shareUrlOverride !== undefined
      ? shareUrlOverride
      : origin.shareToken
        ? `${SITE.liveUrl}/share/${origin.shareToken}`
        : null;

  const loadChain = useCallback(async () => {
    const response = await fetch(`/api/integrity/replay?id=${encodeURIComponent(origin.id)}`, {
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage({ tone: "bad", text: payload?.error?.message ?? "Replay failed." });
      return;
    }
    setEvents(payload.events ?? []);
    setReplay({
      originId: payload.originId,
      ok: payload.ok,
      checked: payload.checked,
      genesis: payload.genesis,
      headSeal: payload.headSeal,
      brokenAtSeq: payload.brokenAtSeq,
      brokenReason: payload.brokenReason,
      events: [],
    });
  }, [origin.id]);

  // Lazy load on tab activation. State is set from the fetch callbacks, so the
  // effect body performs no synchronous update.
  useEffect(() => {
    if (tab !== "chain" || events !== null) return;
    let cancelled = false;

    fetch(`/api/integrity/replay?id=${encodeURIComponent(origin.id)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: Record<string, unknown>) => {
        if (cancelled) return;
        if (payload?.error) {
          setMessage({ tone: "bad", text: String((payload.error as { message?: string }).message) });
          return;
        }
        setEvents((payload.events ?? []) as ChainEvent[]);
        setReplay({
          originId: payload.originId as string,
          ok: payload.ok as boolean,
          checked: payload.checked as number,
          genesis: payload.genesis as string,
          headSeal: payload.headSeal as string,
          brokenAtSeq: payload.brokenAtSeq as number | null,
          brokenReason: payload.brokenReason as string | null,
          events: [],
        });
      })
      .catch(() => {
        if (!cancelled) setMessage({ tone: "bad", text: "Could not replay the chain." });
      });

    return () => {
      cancelled = true;
    };
  }, [tab, events, origin.id]);

  const patch = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    setMessage(null);
    try {
      const response = await fetch(`/api/origins/${encodeURIComponent(origin.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage({ tone: "bad", text: payload?.error?.message ?? `Update failed (${response.status})` });
        return false;
      }
      setOrigin(payload.origin);
      setEvents(null);
      setMessage({ tone: "ok", text: `${label} recorded. Chain head ${shortSeal(payload.chainHead)}.` });
      router.refresh();
      return true;
    } catch (error) {
      setMessage({ tone: "bad", text: error instanceof Error ? error.message : "Update failed." });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const reassay = async () => {
    setBusy("assay");
    setMessage(null);
    try {
      const response = await fetch(`/api/origins/${encodeURIComponent(origin.id)}/assay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage({ tone: "bad", text: payload?.error?.message ?? "Re-assay failed." });
        return;
      }
      setOrigin(payload.origin);
      setEvents(null);
      setMessage({
        tone: "ok",
        text: `Re-assayed with ${payload.comparator} â€” ${payload.result.score.toFixed(2)} / 100.`,
      });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "bad", text: error instanceof Error ? error.message : "Re-assay failed." });
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    setBusy("share");
    setMessage(null);
    try {
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "share_origin", arguments: { origin_id: origin.id, revoke: Boolean(origin.shareToken) } },
        }),
      });
      const payload = await response.json();
      if (payload?.error || payload?.result?.isError) {
        setMessage({ tone: "bad", text: payload?.result?.content?.[0]?.text ?? "Share failed." });
        return;
      }
      const token = payload?.result?.structuredContent?.shareToken as string | null;
      setShareUrlOverride(token ? `${SITE.liveUrl}/share/${token}` : null);
      setMessage({
        tone: "ok",
        text: token ? "Share link issued through the agent tool." : "Share link revoked.",
      });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "bad", text: error instanceof Error ? error.message : "Share failed." });
    } finally {
      setBusy(null);
    }
  };

  const retire = async () => {
    setBusy("retire");
    setMessage(null);
    try {
      const response = await fetch(`/api/origins/${encodeURIComponent(origin.id)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) {
        setMessage({ tone: "bad", text: payload?.error?.message ?? "Retirement failed." });
        return;
      }
      setOrigin(payload.origin);
      setMessage({
        tone: "ok",
        text: `Retired as a tombstone. The chain is still ${payload.replayable ? "replayable" : "not replayable"} with ${payload.eventCount} event(s).`,
      });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "bad", text: error instanceof Error ? error.message : "Retirement failed." });
    } finally {
      setBusy(null);
    }
  };

  const deleted = Boolean(origin.deletedAt);

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="specimen p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="marginalia">specimen {origin.id}</p>
            <h1 className="mt-1 text-2xl text-bone sm:text-3xl">{origin.name}</h1>
            <p className="mt-1 font-mono text-xs text-bone-faint">
              {origin.symbol ? `${origin.symbol} Â· ` : ""}
              <a
                href={`https://solscan.io/token/${origin.mint}`}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all underline decoration-brass/40 underline-offset-4 hover:text-brass"
              >
                {origin.mint}
              </a>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-bone-dim">
                status: {origin.status}
              </span>
              {readOnly ? (
                <span className="border border-verdigris/50 px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-verdigris">
                  reference registry Â· read only
                </span>
              ) : null}
              {deleted ? (
                <span className="border border-oxide/60 px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-oxide-bright">
                  tombstone
                </span>
              ) : null}
            </div>
          </div>

          {origin.assay ? (
            <ScoreStamp
              score={origin.assay.score}
              verdict={origin.assay.verdict}
              degraded={origin.assay.degraded}
            />
          ) : null}
        </div>

        {origin.claimNote ? (
          <p className="mt-4 border-l-2 border-brass/40 pl-3 text-sm leading-relaxed text-bone-dim">
            {origin.claimNote}
          </p>
        ) : null}

        {/* Actions */}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-brass/15 pt-5">
          <a
            href={`/api/export?id=${encodeURIComponent(origin.id)}&format=md`}
            className="border border-brass bg-brass px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-ink transition-colors hover:bg-brass-bright"
            data-testid="export-markdown"
          >
            Export dossier
          </a>
          <a
            href={`/api/export?id=${encodeURIComponent(origin.id)}&format=json`}
            className="border border-brass/40 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-bone-dim transition-colors hover:border-brass hover:text-brass"
          >
            JSON
          </a>
          <button
            type="button"
            onClick={() => void reassay()}
            disabled={busy !== null || readOnly || deleted}
            className="border border-brass/40 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-bone-dim transition-colors hover:border-brass hover:text-brass disabled:opacity-40"
            data-testid="reassay"
          >
            {busy === "assay" ? "Re-assayingâ€¦" : "Re-assay live"}
          </button>
          {!readOnly ? (
            <button
              type="button"
              onClick={() => void share()}
              disabled={busy !== null}
              className="border border-brass/40 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-bone-dim transition-colors hover:border-brass hover:text-brass disabled:opacity-40"
            >
              {origin.shareToken ? "Revoke share" : "Share dossier"}
            </button>
          ) : null}
        </div>

        {shareUrl ? (
          <div className="mt-3 flex items-center gap-2 border border-verdigris/40 bg-verdigris/10 px-3 py-2">
            <span className="marginalia">share</span>
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-bone">{shareUrl}</code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(shareUrl);
                setMessage({ tone: "ok", text: "Share link copied to the clipboard." });
              }}
              className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-brass underline underline-offset-4"
            >
              Copy
            </button>
          </div>
        ) : null}

        {message ? (
          <p
            role="status"
            data-testid="detail-message"
            className={`mt-3 border px-3 py-2 font-mono text-xs ${
              message.tone === "ok"
                ? "border-verdigris/50 bg-verdigris/10 text-verdigris"
                : "border-oxide/60 bg-oxide/10 text-oxide-bright"
            }`}
          >
            {message.text}
          </p>
        ) : null}
      </section>

      {/* Tabs */}
      <div role="tablist" aria-label="Specimen views" className="flex gap-1 border-b border-brass/25">
        {(["evidence", "chain"] as Tab[]).map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`-mb-px border-b-2 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] transition-colors ${
              tab === value ? "border-brass text-brass" : "border-transparent text-bone-dim hover:text-bone"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      {tab === "evidence" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="specimen p-5">
            <h2 className="marginalia">factor breakdown</h2>
            {origin.assay ? (
              <>
                <div className="mt-3">
                  <FactorBars result={origin.assay} />
                </div>
                <p className="mt-4 border-t border-brass/15 pt-4 text-sm leading-relaxed text-bone-dim">
                  {origin.assay.recommendation}
                </p>
                <p className="marginalia mt-3">{origin.assay.engineVersion}</p>
              </>
            ) : (
              <p className="mt-3 text-sm text-bone-dim">
                No assay stored yet. Use â€œRe-assay liveâ€ to compute one against current chain data.
              </p>
            )}
          </section>

          <div className="space-y-6">
            <section className="specimen p-5">
              <h2 className="marginalia">closest registered identities</h2>
              <div className="mt-3">
                <NeighborList neighbors={origin.assay?.neighbors ?? []} />
              </div>
            </section>

            {!readOnly && !deleted ? (
              <section className="specimen p-5">
                <h2 className="marginalia">record a verdict</h2>
                <label htmlFor="verdict-note" className="sr-only">
                  Verdict note
                </label>
                <textarea
                  id="verdict-note"
                  rows={2}
                  maxLength={600}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Note attached to this decision"
                  className="mt-3 w-full resize-y border border-brass/30 bg-surface-sunken px-3 py-2 text-sm text-bone placeholder:text-bone-faint focus:border-brass focus:outline-none"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void patch({ status: "registered", note }, "registered")}
                    disabled={busy !== null}
                    data-testid="verdict-registered"
                    className="border border-verdigris/60 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-verdigris transition-colors hover:bg-verdigris/15 disabled:opacity-40"
                  >
                    Attest
                  </button>
                  <button
                    type="button"
                    onClick={() => void patch({ status: "disputed", note }, "disputed")}
                    disabled={busy !== null}
                    data-testid="verdict-disputed"
                    className="border border-oxide/60 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-oxide-bright transition-colors hover:bg-oxide/15 disabled:opacity-40"
                  >
                    Dispute
                  </button>
                  <button
                    type="button"
                    onClick={() => void retire()}
                    disabled={busy !== null}
                    data-testid="retire"
                    className="border border-bone-faint/50 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-bone-dim transition-colors hover:border-oxide hover:text-oxide-bright disabled:opacity-40"
                  >
                    {busy === "retire" ? "Retiringâ€¦" : "Retire claim"}
                  </button>
                </div>
              </section>
            ) : null}

            <section className="specimen p-5">
              <h2 className="marginalia">claim record</h2>
              <dl className="mt-3 space-y-2 font-mono text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-bone-faint">claimed at</dt>
                  <dd className="text-bone-dim">{origin.claimedAt}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-bone-faint">filed</dt>
                  <dd className="text-bone-dim">{origin.createdAt}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-bone-faint">events</dt>
                  <dd className="text-bone-dim">{origin.eventCount}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-bone-faint">chain head</dt>
                  <dd className="break-all text-brass">{shortSeal(origin.chainHead)}</dd>
                </div>
              </dl>
            </section>
          </div>
        </div>
      ) : (
        <section className="specimen p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="marginalia">audit chain</h2>
            <button
              type="button"
              onClick={() => void loadChain()}
              className="font-mono text-xs uppercase tracking-[0.12em] text-bone-dim underline underline-offset-4 hover:text-brass"
            >
              {busy === "chain" ? "Replayingâ€¦" : "Replay now"}
            </button>
          </div>

          {replay ? (
            <div
              className={`mt-3 border px-3 py-2 font-mono text-xs ${
                replay.ok ? "border-verdigris/50 text-verdigris" : "border-oxide text-oxide-bright"
              }`}
              data-testid="replay-result"
            >
              {replay.ok
                ? `Chain verified: ${replay.checked} event(s), no broken link. Head ${shortSeal(replay.headSeal)}.`
                : `BROKEN at seq ${replay.brokenAtSeq} â€” ${replay.brokenReason}`}
            </div>
          ) : null}

          {replay ? (
            <p className="marginalia mt-3">genesis {replay.genesis}</p>
          ) : null}

          {events === null ? (
            <p className="mt-4 font-mono text-xs text-bone-faint">Reading chain eventsâ€¦</p>
          ) : events.length === 0 ? (
            <p className="mt-4 font-mono text-xs text-bone-faint">No events recorded.</p>
          ) : (
            <div className="scroller mt-4">
              <table className="w-full min-w-[36rem] border-collapse text-sm">
                <caption className="sr-only">Audit events for this origin</caption>
                <thead>
                  <tr className="border-b border-brass/30">
                    <th scope="col" className="marginalia py-2 pr-3 text-left">seq</th>
                    <th scope="col" className="marginalia py-2 pr-3 text-left">event</th>
                    <th scope="col" className="marginalia py-2 pr-3 text-left">seal</th>
                    <th scope="col" className="marginalia py-2 text-left">recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.seq} className="ledger-row">
                      <td className="py-2 pr-3 font-mono text-xs tabular-nums text-bone-dim">{event.seq}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-bone">{event.eventType}</td>
                      <td className="py-2 pr-3 font-mono text-[0.68rem] text-brass">
                        {shortSeal(event.seal)}
                      </td>
                      <td className="py-2 font-mono text-[0.68rem] text-bone-faint">{event.createdAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-4 font-mono text-[0.7rem] leading-relaxed text-bone-faint">
            seal(n) = SHA-384(UTF-8(seal(n-1)) || canonicalJson(event(n))). Replay recomputes every
            seal from the genesis and stops at the first link that does not verify.
          </p>
        </section>
      )}

      <Link
        href="/registry"
        className="inline-block font-mono text-xs uppercase tracking-[0.14em] text-brass underline underline-offset-4"
      >
        Back to the registry
      </Link>
    </div>
  );
}