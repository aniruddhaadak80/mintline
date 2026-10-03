"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatUsd } from "@/lib/format";
import type { AssayResult, MintFacts, NeighborMatch } from "@/lib/types";

export { formatUsd, shortSeal } from "@/lib/format";

/* ------------------------------------------------------------------ *
 * Presentation helpers
 * ------------------------------------------------------------------ */

export const VERDICT_STYLE: Record<string, { label: string; color: string; ring: string }> = {
  attested_origin: {
    label: "Attested origin",
    color: "text-brass",
    ring: "border-brass/70",
  },
  unregistered: {
    label: "Unregistered",
    color: "text-verdigris",
    ring: "border-verdigris/60",
  },
  collision_suspected: {
    label: "Collision suspected",
    color: "text-oxide-bright",
    ring: "border-oxide/70",
  },
  impersonation_likely: {
    label: "Impersonation likely",
    color: "text-oxide-bright",
    ring: "border-oxide",
  },
};

/* ------------------------------------------------------------------ *
 * Score dial
 * ------------------------------------------------------------------ */

/**
 * The stamped score.
 *
 * The stamp's ink density is the score, and its rotation is derived from the
 * score too, so the mark is a readout rather than decoration. With reduced
 * motion the mark renders statically at the same density.
 */
export function ScoreStamp({
  score,
  verdict,
  degraded,
  size = "lg",
}: {
  score: number;
  verdict: string;
  degraded: boolean;
  size?: "sm" | "lg";
}) {
  const style = VERDICT_STYLE[verdict] ?? VERDICT_STYLE.unregistered;
  const ink = Math.max(0.18, Math.min(1, score / 100));
  const rotation = -4 + (score / 100) * 4;

  const dimension = size === "lg" ? "text-4xl sm:text-5xl" : "text-2xl";

  return (
    <div
      className={`stamp-mark ${dimension} ${style.color} ${style.ring} animate-press font-mono`}
      style={{
        opacity: 0.45 + ink * 0.55,
        transform: `rotate(${rotation.toFixed(2)}deg)`,
        borderWidth: size === "lg" ? 3 : 2,
      }}
      role="img"
      aria-label={`Provenance integrity ${score.toFixed(2)} out of 100 — ${style.label}${
        degraded ? ", partial computation" : ""
      }`}
    >
      <span className="tabular-nums">{score.toFixed(1)}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Factor bars
 * ------------------------------------------------------------------ */

export function FactorBars({ result }: { result: AssayResult }) {
  return (
    <ul className="space-y-3">
      {result.factors.map((factor) => {
        const unavailable = factor.availability === "unavailable";
        return (
          <li key={factor.key} className="border-b border-brass/12 pb-3 last:border-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-xs uppercase tracking-[0.12em] text-bone">
                {factor.label}
              </span>
              <span className="font-mono text-xs tabular-nums text-bone-dim">
                {factor.points.toFixed(2)} pts
                <span className="text-bone-faint">
                  {" "}
                  · w {factor.weight.toFixed(2)}
                </span>
              </span>
            </div>

            <div
              className="mt-1.5 h-2 w-full overflow-hidden bg-surface-sunken"
              role="meter"
              aria-valuenow={Math.round(factor.value * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${factor.label}: ${(factor.value * 100).toFixed(1)} out of 100`}
            >
              <div
                className={`h-full ${unavailable ? "bg-bone-faint/40" : "bg-brass"}`}
                style={{ width: `${Math.max(2, factor.value * 100)}%` }}
              />
            </div>

            <p className="mt-1.5 font-mono text-[0.7rem] leading-relaxed text-bone-faint">
              {factor.evidence}
            </p>
            {unavailable ? (
              <p className="mt-1 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-oxide-bright">
                not measured — contributes zero
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Neighbors
 * ------------------------------------------------------------------ */

export function NeighborList({ neighbors }: { neighbors: NeighborMatch[] }) {
  if (neighbors.length === 0) {
    return (
      <p className="font-mono text-xs text-bone-faint">
        No identity in the registry scored above the comparison threshold.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {neighbors.map((neighbor) => (
        <li
          key={`${neighbor.originId ?? neighbor.name}-${neighbor.similarity}`}
          className="ledger-row ledger-row-hover flex flex-wrap items-baseline justify-between gap-2 py-2 pl-2 pr-1"
        >
          <div className="min-w-0">
            <p className="truncate text-sm text-bone">
              {neighbor.name}
              {neighbor.symbol ? (
                <span className="ml-2 font-mono text-xs text-bone-faint">{neighbor.symbol}</span>
              ) : null}
              {!neighbor.registered ? (
                <span className="ml-2 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-verdigris">
                  reference
                </span>
              ) : null}
            </p>
            {neighbor.sharedTerms.length > 0 ? (
              <p className="mt-0.5 font-mono text-[0.7rem] text-bone-faint">
                shared: {neighbor.sharedTerms.join(", ")}
              </p>
            ) : null}
          </div>
          <span className="font-mono text-sm tabular-nums text-brass">
            {neighbor.similarity.toFixed(4)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Source attribution
 * ------------------------------------------------------------------ */

export function SourceList({ facts }: { facts: MintFacts }) {
  return (
    <ul className="space-y-2">
      {facts.sources.map((source) => (
        <li key={`${source.id}-${source.endpoint}`} className="border-b border-brass/12 pb-2 last:border-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <a
              href={source.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-bone underline decoration-brass/40 underline-offset-4 hover:text-brass"
            >
              {source.label}
            </a>
            <span
              className={`font-mono text-[0.65rem] uppercase tracking-[0.14em] ${
                source.status === "live" ? "text-verdigris" : "text-oxide-bright"
              }`}
            >
              {source.status}
            </span>
          </div>
          <p className="mt-0.5 break-all font-mono text-[0.68rem] text-bone-faint">
            {source.endpoint}
          </p>
          <p className="font-mono text-[0.68rem] text-bone-faint">fetched {source.fetchedAt}</p>
          {source.note ? (
            <p className="mt-1 font-mono text-[0.7rem] leading-relaxed text-oxide-bright">
              {source.note}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * The Assay Press — the signature interaction
 * ------------------------------------------------------------------ */

export interface PressState {
  phase: "idle" | "fetching" | "assaying" | "embedding" | "ready" | "error";
  facts: MintFacts | null;
  result: AssayResult | null;
  neighbors: NeighborMatch[];
  comparator: string;
  error: string | null;
  note: string | null;
}

const IDLE: PressState = {
  phase: "idle",
  facts: null,
  result: null,
  neighbors: [],
  comparator: "",
  error: null,
  note: null,
};

/**
 * The Assay Press.
 *
 * Feed it a mint and it: reads live chain facts, asks the server for the
 * deterministic score, then loads the open-weight model **in this browser** and
 * re-scores the same mint semantically. The card is stamped with whichever
 * reading finished last, and the comparator that produced it is always shown.
 *
 * This is the ten-second moment: real data in, real computation on your own
 * machine, a real verdict out, with no inference server anywhere in the path.
 */
export function AssayPress({
  defaultMint,
  sampleMints,
  showCreateLink = true,
  action,
}: {
  defaultMint?: string;
  sampleMints: Array<{ mint: string; label: string; symbol: string }>;
  showCreateLink?: boolean;
  /** Extra control rendered beside the press. */
  action?: React.ReactNode;
}) {
  const router = useRouter();
  const [mint, setMint] = useState(defaultMint ?? "");
  const [state, setState] = useState<PressState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (value: string) => {
      const target = value.trim();
      if (!target) {
        setState({ ...IDLE, error: "Enter a Solana mint address to assay." });
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({
        ...IDLE,
        phase: "fetching",
        note: "Reading on-chain metadata and live market facts…",
      });

      try {
        const response = await fetch("/api/assay", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mint: target }),
          signal: controller.signal,
        });

        const payload = await response.json();

        if (!response.ok) {
          setState({
            ...IDLE,
            phase: "error",
            error: payload?.error?.message ?? `Request failed with status ${response.status}`,
          });
          return;
        }

        setState({
          phase: "assaying",
          facts: payload.facts as MintFacts,
          result: payload.result as AssayResult,
          neighbors: (payload.similarity?.neighbors ?? []) as NeighborMatch[],
          comparator: `lexical comparator (${payload.similarity?.model ?? "server"})`,
          error: null,
          note: "Server score received. Loading the open-weight model to re-score on-device…",
        });

        // Upgrade the comparison to on-device embeddings. The engine is the
        // same function; only the similarity input changes.
        try {
          const { neuralSimilarity } = await import("@/lib/engine/embed");
          const { runAssay } = await import("@/lib/engine/assay");

          const corpus = ((payload.corpus ?? []) as Array<{
            originId: string | null;
            name: string;
            symbol: string | null;
            mint: string | null;
            text: string;
            registered: boolean;
          }>).filter((entry) => entry.mint !== target);

          const similarity = await neuralSimilarity(
            [
              payload.identity?.name,
              payload.identity?.symbol,
              payload.identity?.description,
            ]
              .filter(Boolean)
              .join(" ") || target,
            corpus,
          );

          const neuralResult = runAssay(
            {
              mint: target,
              identityText: payload.identity?.name ?? "",
              facts: payload.facts as MintFacts,
              similarity,
              existingClaims: payload.existingClaims ?? [],
            },
            null,
          );

          if (controller.signal.aborted) return;

          setState({
            phase: "ready",
            facts: payload.facts as MintFacts,
            result: neuralResult,
            neighbors: similarity.neighbors,
            comparator: `on-device embeddings (${similarity.model})`,
            error: null,
            note: "Scored in your browser. The token text never left this device.",
          });
        } catch {
          if (controller.signal.aborted) return;
          setState((previous) => ({
            ...previous,
            phase: "ready",
            note: `On-device model unavailable; showing the server's deterministic score. ${previous.comparator}`,
          }));
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setState({
          ...IDLE,
          phase: "error",
          error: error instanceof Error ? error.message : "The assay request failed.",
        });
      }
    },
    [],
  );

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const busy = state.phase === "fetching" || state.phase === "assaying" || state.phase === "embedding";

  const identity = useMemo(() => {
    if (!state.facts) return null;
    return {
      name: state.facts.metadata?.name ?? state.facts.pairs[0]?.baseToken.name ?? null,
      symbol: state.facts.metadata?.symbol ?? state.facts.pairs[0]?.baseToken.symbol ?? null,
    };
  }, [state.facts]);

  return (
    <section aria-label="Assay press" className="specimen p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-mono text-sm uppercase tracking-[0.2em] text-brass">
          Assay press
        </h2>
        <p className="marginalia">live chain read · on-device scoring</p>
      </div>

      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void run(mint);
        }}
      >
        <label htmlFor="press-mint" className="sr-only">
          Solana mint address
        </label>
        <input
          id="press-mint"
          name="mint"
          value={mint}
          onChange={(event) => setMint(event.target.value)}
          placeholder="Paste a Solana mint address"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          className="w-full flex-1 border border-brass/30 bg-surface-sunken px-3 py-2.5 font-mono text-sm text-bone placeholder:text-bone-faint focus:border-brass focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="border border-brass bg-brass px-5 py-2.5 font-mono text-xs uppercase tracking-[0.16em] text-ink transition-colors hover:bg-brass-bright disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Assaying…" : "Strike specimen"}
        </button>
      </form>

      {sampleMints.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="marginalia">try</span>
          {sampleMints.map((sample) => (
            <button
              key={sample.mint}
              type="button"
              onClick={() => {
                setMint(sample.mint);
                void run(sample.mint);
              }}
              className="border border-brass/25 px-2 py-1 font-mono text-[0.7rem] text-bone-dim transition-colors hover:border-brass hover:text-brass"
            >
              {sample.symbol}
            </button>
          ))}
        </div>
      ) : null}

      {state.note ? (
        <p className="mt-3 font-mono text-[0.72rem] leading-relaxed text-verdigris" role="status">
          {state.note}
        </p>
      ) : null}

      {state.error ? (
        <p
          className="mt-3 border border-oxide/60 bg-oxide/10 px-3 py-2 font-mono text-[0.72rem] text-oxide-bright"
          role="alert"
          data-testid="press-error"
        >
          {state.error}
        </p>
      ) : null}

      {state.result && state.facts ? (
        <div className="animate-file-in mt-6 border-t border-brass/20 pt-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="marginalia">specimen</p>
              <p className="mt-1 text-xl text-bone">{identity?.name ?? "Unnamed mint"}</p>
              <p className="mt-1 font-mono text-xs text-bone-faint">
                {identity?.symbol ? `${identity.symbol} · ` : ""}
                {state.facts.mint}
              </p>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-bone-dim">
                {state.result.recommendation}
              </p>
            </div>
            <div className="shrink-0">
              <ScoreStamp
                score={state.result.score}
                verdict={state.result.verdict}
                degraded={state.result.degraded}
              />
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-brass/15 pt-4 sm:grid-cols-4">
            <div>
              <dt className="marginalia">liquidity</dt>
              <dd className="mt-0.5 font-mono text-sm tabular-nums text-bone">
                {formatUsd(state.facts.liquidityUsd)}
              </dd>
            </div>
            <div>
              <dt className="marginalia">24h volume</dt>
              <dd className="mt-0.5 font-mono text-sm tabular-nums text-bone">
                {formatUsd(state.facts.volume24h)}
              </dd>
            </div>
            <div>
              <dt className="marginalia">age</dt>
              <dd className="mt-0.5 font-mono text-sm tabular-nums text-bone">
                {state.facts.ageDays === null ? "—" : `${state.facts.ageDays.toFixed(0)}d`}
              </dd>
            </div>
            <div>
              <dt className="marginalia">venues</dt>
              <dd className="mt-0.5 font-mono text-sm tabular-nums text-bone">
                {state.facts.pairCount}/{state.facts.dexCount}
              </dd>
            </div>
          </dl>

          <div className="mt-5 grid gap-6 lg:grid-cols-2">
            <div>
              <p className="marginalia">factor breakdown</p>
              <div className="mt-2">
                <FactorBars result={state.result} />
              </div>
            </div>
            <div className="space-y-5">
              <div>
                <p className="marginalia">closest registered identities</p>
                <div className="mt-2">
                  <NeighborList neighbors={state.neighbors} />
                </div>
              </div>
              <div>
                <p className="marginalia">comparator</p>
                <p className="mt-1 break-all font-mono text-[0.7rem] text-bone-dim">
                  {state.comparator}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-brass/15 pt-5">
            {showCreateLink && identity?.name ? (
              <Link
                href={`/registry?mint=${encodeURIComponent(state.facts.mint)}&name=${encodeURIComponent(
                  identity.name,
                )}&symbol=${encodeURIComponent(identity.symbol ?? "")}`}
                className="border border-brass bg-brass px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-ink transition-colors hover:bg-brass-bright"
              >
                Register this origin
              </Link>
            ) : null}
            <Link
              href={`/assay?mint=${encodeURIComponent(state.facts.mint)}`}
              className="border border-brass/40 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-bone-dim transition-colors hover:border-brass hover:text-brass"
            >
              Open in assay lab
            </Link>
            {action}
          </div>
        </div>
      ) : null}

      {state.result && !showCreateLink ? (
        <button
          type="button"
          onClick={() => router.push("/registry")}
          className="mt-4 font-mono text-xs uppercase tracking-[0.14em] text-brass underline underline-offset-4"
        >
          Go to the registry
        </button>
      ) : null}
    </section>
  );
}