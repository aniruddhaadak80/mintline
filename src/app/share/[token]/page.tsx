import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getOriginByShareToken } from "@/lib/db/repository";
import { getSql } from "@/lib/db/sql";
import { ensureSchema } from "@/lib/db/schema";
import { getChainEvents } from "@/lib/db/repository";
import { loadMintFacts } from "@/lib/solana/live";
import { SAFETY_DISCLAIMER } from "@/lib/export/dossier";
import { replayChain } from "@/lib/integrity/chain";
import { formatUsd, shortSeal } from "@/lib/format";
import { FactorBars, ScoreStamp, VERDICT_STYLE } from "@/components/AssayPress";
import { SITE } from "@/lib/config";

export const dynamic = "force-dynamic";

const TOKEN_RE = /^[0-9a-f]{32}$/;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) return { title: "Dossier", robots: { index: false, follow: false } };

  try {
    const sql = await getSql();
    await ensureSchema(sql);
    const origin = await getOriginByShareToken(token);
    if (!origin) return { title: "Dossier", robots: { index: false, follow: false } };

    return {
      title: `${origin.name} — origin dossier`,
      description: `Shared provenance dossier for ${origin.name} on Solana mint ${origin.mint}.`,
      robots: { index: false, follow: false },
    };
  } catch {
    return { title: "Dossier", robots: { index: false, follow: false } };
  }
}

/**
 * Public share route.
 *
 * Reachable only with an unguessable share token that the owner explicitly
 * issued — never by id, so this is not a way to enumerate anyone's records. It
 * renders the dossier read-only, with no write controls at all.
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) notFound();

  const sql = await getSql();
  await ensureSchema(sql);

  const origin = await getOriginByShareToken(token);
  if (!origin) notFound();

  const [events, facts] = await Promise.all([
    getChainEvents("registry", origin.id).catch(() => []),
    loadMintFacts(origin.mint, { allowFallback: true }).catch(() => null),
  ]);

  // Replay is recomputed for the shared view too; a broken chain is shown, not hidden.
  const replayResult = events.length > 0 ? replayChain(origin.id, events) : null;

  const verdict = origin.assay?.verdict ?? null;
  const style = verdict ? VERDICT_STYLE[verdict] : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <header className="border-b border-brass/25 pb-6">
        <p className="marginalia">shared dossier · read only</p>
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl text-bone">{origin.name}</h1>
            <p className="mt-1 font-mono text-xs text-bone-faint">
              {origin.symbol ? `${origin.symbol} · ` : ""}
              <a
                href={`https://solscan.io/token/${origin.mint}`}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all underline decoration-brass/40 underline-offset-4 hover:text-brass"
              >
                {origin.mint}
              </a>
            </p>
            <p className="mt-2 font-mono text-[0.7rem] text-bone-faint">
              claimed {origin.claimedAt} · status {origin.status}
              {origin.deletedAt ? " · tombstone" : ""}
            </p>
          </div>
          {origin.assay ? (
            <ScoreStamp
              score={origin.assay.score}
              verdict={origin.assay.verdict}
              degraded={origin.assay.degraded}
            />
          ) : null}
        </div>
      </header>

      {origin.assay ? (
        <section className="mt-8">
          <p className="marginalia">verdict</p>
          <p className={`mt-1 font-mono text-sm uppercase tracking-[0.12em] ${style?.color ?? "text-bone-dim"}`}>
            {style?.label ?? "Not assayed"}
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-bone-dim">
            {origin.assay.recommendation}
          </p>
          <p className="marginalia mt-2">{origin.assay.engineVersion}</p>
        </section>
      ) : null}

      {origin.assay ? (
        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="specimen p-5">
            <h2 className="marginalia">factor breakdown</h2>
            <div className="mt-3">
              <FactorBars result={origin.assay} />
            </div>
          </div>

          <div className="space-y-6">
            {facts ? (
              <div className="specimen p-5">
                <h2 className="marginalia">live facts</h2>
                <dl className="mt-3 space-y-2 font-mono text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-bone-faint">liquidity</dt>
                    <dd className="text-bone-dim">{formatUsd(facts.liquidityUsd)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-bone-faint">24h volume</dt>
                    <dd className="text-bone-dim">{formatUsd(facts.volume24h)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-bone-faint">age</dt>
                    <dd className="text-bone-dim">
                      {facts.ageDays === null ? "—" : `${facts.ageDays.toFixed(0)} days`}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-bone-faint">holder concentration</dt>
                    <dd className="text-bone-dim">
                      {facts.holders.state === "ok"
                        ? `${((facts.holders.topShare ?? 0) * 100).toFixed(1)}% top ${facts.holders.accountsInspected}`
                        : "unavailable"}
                    </dd>
                  </div>
                </dl>
                <ul className="mt-4 space-y-1.5">
                  {facts.sources.map((source) => (
                    <li key={`${source.id}-${source.endpoint}`} className="flex items-baseline justify-between gap-2">
                      <a
                        href={source.homepage}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-bone-dim underline decoration-brass/30 underline-offset-4 hover:text-brass"
                      >
                        {source.label}
                      </a>
                      <span
                        className={`font-mono text-[0.62rem] uppercase tracking-[0.12em] ${
                          source.status === "live" ? "text-verdigris" : "text-oxide-bright"
                        }`}
                      >
                        {source.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="specimen p-5">
              <h2 className="marginalia">integrity</h2>
              <p
                className={`mt-3 font-mono text-xs ${replayResult?.ok === false ? "text-oxide-bright" : "text-verdigris"}`}
              >
                {replayResult
                  ? replayResult.ok
                    ? `verified · ${replayResult.checked} event(s) · no broken link`
                    : `broken at seq ${replayResult.brokenAtSeq}`
                  : "chain unavailable"}
              </p>
              <p className="marginalia mt-3 break-all">head {shortSeal(origin.chainHead)}</p>
              <ul className="mt-2 space-y-1">
                {events.map((event) => (
                  <li key={event.seq} className="flex justify-between gap-2 font-mono text-[0.66rem]">
                    <span className="text-bone-dim">
                      {event.seq} · {event.eventType}
                    </span>
                    <span className="text-brass">{shortSeal(event.seal)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mt-8 border-t border-brass/25 pt-6">
        <p className="marginalia">disclaimer</p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-bone-faint">{SAFETY_DISCLAIMER}</p>
      </section>

      <p className="mt-6 font-mono text-[0.7rem] text-bone-faint">
        Shared from{" "}
        <a href={SITE.liveUrl} className="text-brass underline underline-offset-4">
          {SITE.liveUrl}
        </a>{" "}
        ·{" "}
        <a
          href={SITE.repositoryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brass underline underline-offset-4"
        >
          source
        </a>
      </p>
    </div>
  );
}