"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { shortSeal } from "./AssayPress";
import type { OriginRecord, Paginated } from "@/lib/types";

/**
 * Dossier builder.
 *
 * The claim list arrives from the server component, so this holds no mirrored
 * copy of it and needs no fetching effect. Choosing a claim enables real
 * download links that hit `/api/export`, which builds the artifact server-side
 * from the stored record, live facts and the chain — so the file a visitor keeps
 * is the same file the API serves to anyone else.
 */
export function DossierBuilder({ initial }: { initial: Paginated<OriginRecord> }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(initial.items[0]?.id ?? null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const record = initial.items.find((item) => item.id === selected) ?? null;

  const loadPreview = async (format: "md" | "json") => {
    if (!selected) return;
    setLoadingPreview(true);
    setError(null);
    try {
      const response = await fetch(`/api/export?id=${encodeURIComponent(selected)}&format=${format}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error?.message ?? `Export failed (${response.status})`);
        return;
      }
      const text = await response.text();
      setPreview(text.slice(0, 12_000));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Export failed.");
    } finally {
      setLoadingPreview(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <section className="specimen p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="marginalia">claims on file</h2>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-bone-dim underline underline-offset-4 hover:text-brass"
          >
            refresh
          </button>
        </div>

        {error ? (
          <p className="mt-3 border border-oxide/60 bg-oxide/10 px-3 py-2 font-mono text-xs text-oxide-bright" role="alert">
            {error}
          </p>
        ) : null}

        {initial.items.length === 0 ? (
          <p className="mt-4 font-mono text-xs text-bone-faint">
            Nothing on file yet.{" "}
            <Link href="/registry" className="text-brass underline underline-offset-4">
              Register a claim
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-3 max-h-[28rem] overflow-y-auto">
            {initial.items.map((item) => (
              <li key={item.id} className="ledger-row">
                <button
                  type="button"
                  onClick={() => {
                    setSelected(item.id);
                    setPreview(null);
                  }}
                  aria-pressed={selected === item.id}
                  className={`w-full px-1 py-2.5 text-left transition-colors ${
                    selected === item.id ? "bg-brass/10" : "hover:bg-brass/5"
                  }`}
                >
                  <span className="block truncate text-sm text-bone">{item.name}</span>
                  <span className="mt-0.5 block font-mono text-[0.65rem] text-bone-faint">
                    {item.assay ? `score ${item.assay.score.toFixed(1)}` : "not assayed"} ·{" "}
                    {shortSeal(item.chainHead)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="specimen p-5">
        {!record ? (
          <p className="font-mono text-xs text-bone-faint">Select a claim to build its dossier.</p>
        ) : (
          <>
            <p className="marginalia">dossier for</p>
            <h2 className="mt-1 text-xl text-bone">{record.name}</h2>
            <p className="mt-1 break-all font-mono text-xs text-bone-faint">{record.mint}</p>

            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <dt className="marginalia">score</dt>
                <dd className="mt-0.5 font-mono text-sm tabular-nums text-brass">
                  {record.assay ? record.assay.score.toFixed(2) : "—"}
                </dd>
              </div>
              <div>
                <dt className="marginalia">verdict</dt>
                <dd className="mt-0.5 font-mono text-[0.7rem] text-bone-dim">
                  {record.assay?.verdict.replace(/_/g, " ") ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="marginalia">events</dt>
                <dd className="mt-0.5 font-mono text-sm tabular-nums text-bone-dim">{record.eventCount}</dd>
              </div>
              <div>
                <dt className="marginalia">status</dt>
                <dd className="mt-0.5 font-mono text-[0.7rem] text-bone-dim">
                  {record.status}
                  {record.deletedAt ? " · tombstone" : ""}
                </dd>
              </div>
            </dl>

            <div className="mt-5 flex flex-wrap gap-2">
              <a
                href={`/api/export?id=${encodeURIComponent(record.id)}&format=md`}
                className="border border-brass bg-brass px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-ink transition-colors hover:bg-brass-bright"
                data-testid="dossier-download-md"
              >
                Download Markdown
              </a>
              <a
                href={`/api/export?id=${encodeURIComponent(record.id)}&format=json`}
                className="border border-brass/40 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-bone-dim transition-colors hover:border-brass hover:text-brass"
              >
                Download JSON
              </a>
              <button
                type="button"
                onClick={() => void loadPreview("md")}
                disabled={loadingPreview}
                className="border border-brass/40 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-bone-dim transition-colors hover:border-brass hover:text-brass disabled:opacity-40"
              >
                {loadingPreview ? "Rendering…" : "Preview"}
              </button>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-bone-faint">
              The dossier is generated server-side from the stored record, a fresh live read and the
              sealed chain. It carries the factor breakdown, per-source attribution with fetch
              timestamps, the full seal list and the safety disclaimer — enough to stand on its own in a
              launchpad review or a bug report.
            </p>

            {preview ? (
              <pre className="well mt-4 max-h-[32rem] overflow-auto p-3 text-[0.7rem] leading-relaxed" data-testid="dossier-preview">
                {preview}
              </pre>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}