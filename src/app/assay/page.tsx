import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { AssayPress } from "@/components/AssayPress";
import { SAMPLE_MINTS } from "@/lib/solana/fallback";
import { describeEngine, VERDICT_BANDS } from "@/lib/engine/assay";
import { LEXICAL_MODEL_ID } from "@/lib/engine/similarity";
import { EMBEDDING_LICENSE, EMBEDDING_MODEL_ID, EMBEDDING_PARAMETERS } from "@/lib/engine/model-info";

export const metadata: Metadata = {
  title: "Assay lab",
  description:
    "Run the provenance engine against any Solana mint, see every factor with its evidence, and inspect which comparator produced the score.",
};

function Lab({ searchParams }: { searchParams: Promise<{ mint?: string }> }) {
  return <LabInner searchParams={searchParams} />;
}

async function LabInner({ searchParams }: { searchParams: Promise<{ mint?: string }> }) {
  const params = await searchParams;
  return <AssayPress defaultMint={params.mint} sampleMints={SAMPLE_MINTS} showCreateLink />;
}

export default function AssayPage() {
  const engine = describeEngine();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="border-b border-brass/25 pb-6">
        <p className="marginalia">bench</p>
        <h1 className="mt-2 text-3xl text-bone sm:text-4xl">Assay lab</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-bone-dim">
          Strike a specimen against live chain data. The score is computed twice — once on the server
          with a deterministic lexical comparator, then again in this browser with an open-weight
          sentence-embedding model — and both readings name the comparator that produced them.
        </p>
      </header>

      <div className="mt-8">
        <Suspense fallback={<div className="specimen h-64 animate-pulse" aria-busy="true" />}>
          <Lab searchParams={Promise.resolve({})} />
        </Suspense>
      </div>

      <section className="mt-12 grid gap-6 md:grid-cols-2">
        <div className="specimen p-5">
          <h2 className="marginalia">the two comparators</h2>
          <dl className="mt-3 space-y-3">
            <div>
              <dt className="font-mono text-xs uppercase tracking-[0.12em] text-verdigris">
                server · always available
              </dt>
              <dd className="mt-1 font-mono text-[0.72rem] text-bone-dim">{LEXICAL_MODEL_ID}</dd>
              <dd className="mt-1 text-sm leading-relaxed text-bone-faint">
                Character n-gram cosine blended with token Jaccard. No model, no network, no variance.
              </dd>
            </div>
            <div>
              <dt className="font-mono text-xs uppercase tracking-[0.12em] text-brass">
                browser · on demand
              </dt>
              <dd className="mt-1 font-mono text-[0.72rem] text-bone-dim">{EMBEDDING_MODEL_ID}</dd>
              <dd className="mt-1 text-sm leading-relaxed text-bone-faint">
                {EMBEDDING_LICENSE} weights, {EMBEDDING_PARAMETERS} parameters, int8 quantized, fetched
                once and then cached. Runs on your CPU; the token&apos;s identity text is never sent
                anywhere.
              </dd>
            </div>
          </dl>
        </div>

        <div className="specimen p-5">
          <h2 className="marginalia">engine weights</h2>
          <table className="mt-3 w-full border-collapse text-sm">
            <caption className="sr-only">Factor weights in the provenance engine</caption>
            <thead>
              <tr className="border-b border-brass/30">
                <th scope="col" className="marginalia py-2 pr-3 text-left">factor</th>
                <th scope="col" className="marginalia py-2 text-right">weight</th>
              </tr>
            </thead>
            <tbody>
              {engine.weights.map((weight) => (
                <tr key={weight.key} className="ledger-row">
                  <td className="py-2 pr-3 text-bone-dim">{weight.label}</td>
                  <td className="py-2 text-right font-mono tabular-nums text-brass">
                    {weight.weight.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 font-mono text-[0.7rem] text-bone-faint">{engine.version}</p>
          <p className="mt-2 text-sm leading-relaxed text-bone-faint">
            A factor that cannot be measured contributes zero and flags the result as{" "}
            <code className="text-oxide-bright">degraded</code>. Weights are never rebalanced around a
            gap, so a partial computation cannot masquerade as a confident one.
          </p>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="marginalia">verdict bands</h2>
        <ul className="mt-4 space-y-2">
          {VERDICT_BANDS.map((band) => (
            <li key={band.verdict} className="ledger-row py-2">
              <p className="font-mono text-xs uppercase tracking-[0.1em] text-bone">
                {band.label}{" "}
                <span className="text-brass">
                  {band.min}–{band.max}
                </span>
              </p>
              <p className="mt-1 text-sm text-bone-dim">{band.summary}</p>
              <p className="mt-0.5 text-sm text-bone-faint">{band.action}</p>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-8">
        <Link href="/chain" className="font-mono text-xs uppercase tracking-[0.14em] text-brass underline underline-offset-4">
          Verify an audit chain →
        </Link>
      </p>
    </div>
  );
}