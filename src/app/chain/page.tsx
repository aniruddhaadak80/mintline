import type { Metadata } from "next";
import Link from "next/link";
import { getSql } from "@/lib/db/sql";
import { ensureSchema } from "@/lib/db/schema";
import { ensureSeeded, listOrigins, replayOrigin } from "@/lib/db/repository";
import { getSession } from "@/lib/session";
import { GENESIS_SEAL } from "@/lib/integrity/chain";
import { shortSeal } from "@/lib/integrity/chain";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Chain replay",
  description:
    "Recompute every audit seal from the genesis and report the first broken link. Tamper-evident by construction, replayable by anyone.",
};

export default async function ChainPage() {
  const sql = await getSql();
  await ensureSchema(sql);
  await ensureSeeded(sql);
  const session = await getSession();

  const page = await listOrigins({
    sessionId: session.sessionId,
    includeReference: true,
    limit: 100,
    offset: 0,
    sort: "recent",
  });

  const rows = await Promise.all(
    page.items.map(async (origin) => {
      const replay = await replayOrigin(session.sessionId, origin.id);
      return {
        id: origin.id,
        name: origin.name,
        mint: origin.mint,
        retired: Boolean(origin.deletedAt),
        status: origin.status,
        ok: replay?.ok ?? false,
        checked: replay?.checked ?? 0,
        head: replay?.headSeal ?? origin.chainHead,
        brokenAtSeq: replay?.brokenAtSeq ?? null,
        brokenReason: replay?.brokenReason ?? null,
      };
    }),
  );

  const eventsChecked = rows.reduce((sum, row) => sum + row.checked, 0);
  const broken = rows.filter((row) => !row.ok);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="border-b border-brass/25 pb-6">
        <p className="marginalia">ledger integrity</p>
        <h1 className="mt-2 text-3xl text-bone sm:text-4xl">Chain replay</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-bone-dim">
          Every claim has its own append-only chain. Replay recomputes each seal from the genesis
          rather than trusting a stored flag, so an edited or removed row is caught here. Tombstones are
          retained on purpose: deleting a claim must not break the history of the claim that existed.
        </p>
      </header>

      <section className="mt-8 grid gap-px bg-brass/15 sm:grid-cols-3">
        <div className="bg-ground p-4">
          <p className="marginalia">genesis</p>
          <p className="mt-1 break-all font-mono text-xs text-brass">{GENESIS_SEAL}</p>
          <p className="mt-1 font-mono text-[0.68rem] text-bone-faint">SHA-384 of a fixed salt</p>
        </div>
        <div className="bg-ground p-4">
          <p className="marginalia">chains replayed</p>
          <p className="mt-1 font-mono text-2xl tabular-nums text-bone">{rows.length}</p>
        </div>
        <div className="bg-ground p-4">
          <p className="marginalia">events verified</p>
          <p className="mt-1 font-mono text-2xl tabular-nums text-bone">{eventsChecked}</p>
          <p className={`mt-1 font-mono text-[0.68rem] ${broken.length === 0 ? "text-verdigris" : "text-oxide-bright"}`}>
            {broken.length === 0 ? "no broken links" : `${broken.length} broken chain(s)`}
          </p>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="marginalia">per-claim replay</h2>

        {rows.length === 0 ? (
          <p className="mt-4 font-mono text-xs text-bone-faint">No claims to replay yet.</p>
        ) : (
          <div className="scroller mt-4">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <caption className="sr-only">Replay result for every visible origin claim</caption>
              <thead>
                <tr className="border-b border-brass/30">
                  <th scope="col" className="marginalia py-2 pr-3 text-left">claim</th>
                  <th scope="col" className="marginalia py-2 pr-3 text-left">status</th>
                  <th scope="col" className="marginalia py-2 pr-3 text-right">events</th>
                  <th scope="col" className="marginalia py-2 pr-3 text-left">head seal</th>
                  <th scope="col" className="marginalia py-2 text-left">replay</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="ledger-row align-top">
                    <td className="py-3 pr-3">
                      <Link
                        href={`/registry/${row.id}`}
                        className="text-bone underline decoration-brass/30 underline-offset-4 hover:text-brass"
                      >
                        {row.name}
                      </Link>
                      <p className="mt-0.5 break-all font-mono text-[0.65rem] text-bone-faint">{row.mint}</p>
                    </td>
                    <td className="py-3 pr-3 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-bone-dim">
                      {row.status}
                      {row.retired ? " Â· tombstone" : ""}
                    </td>
                    <td className="py-3 pr-3 text-right font-mono text-xs tabular-nums text-bone-dim">
                      {row.checked}
                    </td>
                    <td className="py-3 pr-3 font-mono text-[0.68rem] text-brass">{shortSeal(row.head)}</td>
                    <td className="py-3 font-mono text-[0.68rem]">
                      {row.ok ? (
                        <span className="text-verdigris">verified</span>
                      ) : (
                        <span className="text-oxide-bright">
                          broken at seq {row.brokenAtSeq} â€” {row.brokenReason}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="specimen mt-10 p-5">
        <h2 className="marginalia">the rule</h2>
        <pre className="well mt-3 p-3 text-[0.72rem] leading-relaxed">
{`genesis    = SHA-384(UTF-8("mintline/genesis/v1"))
seal(n)    = SHA-384( UTF-8(seal(n-1)) || canonicalJson(event(n)) )

canonicalJson  recursive key sort, stable arrays, ISO-8601 UTC,
                undefined dropped, non-finite numbers rejected`}
        </pre>
        <p className="mt-3 text-sm leading-relaxed text-bone-dim">
          Because every seal commits to its predecessor, changing event 1 invalidates every seal after
          it. Replay stops at the first sequence number whose stored canonical form, prevSeal or seal
          does not reproduce, and names it.
        </p>
      </section>

      <p className="mt-8">
        <Link
          href="/api/integrity/replay"
          className="font-mono text-xs uppercase tracking-[0.14em] text-brass underline underline-offset-4"
        >
          Replay every chain over HTTP â†’
        </Link>
      </p>
    </div>
  );
}