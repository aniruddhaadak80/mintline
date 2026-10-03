import type { Metadata } from "next";
import { DossierBuilder } from "@/components/DossierBuilder";
import { getSql } from "@/lib/db/sql";
import { ensureSchema } from "@/lib/db/schema";
import { ensureSeeded, listOrigins } from "@/lib/db/repository";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Export",
  description:
    "Build a downloadable origin dossier: score, factor breakdown, source attribution with timestamps, full seal chain and the safety disclaimer.",
};

export default async function ExportPage() {
  const sql = await getSql();
  await ensureSchema(sql);
  await ensureSeeded(sql);
  const session = await getSession();

  const initial = await listOrigins({
    sessionId: session.sessionId,
    includeReference: true,
    limit: 50,
    offset: 0,
    sort: "recent",
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="border-b border-brass/25 pb-6">
        <p className="marginalia">takeaway</p>
        <h1 className="mt-2 text-3xl text-bone sm:text-4xl">Export a dossier</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-bone-dim">
          The artifact you leave with. It is generated from the stored record rather than from whatever
          the page happens to be showing, so the file matches the ledger even if the chain has moved on
          since you looked at it.
        </p>
      </header>

      <div className="mt-8">
        <DossierBuilder initial={initial} />
      </div>
    </div>
  );
}