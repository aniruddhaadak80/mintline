import Link from "next/link";
import { AssayPress } from "@/components/AssayPress";
import { GitHubLink } from "@/components/GitHubLink";
import { SAMPLE_MINTS } from "@/lib/solana/fallback";
import { SITE } from "@/lib/config";
import { ENGINE_VERSION } from "@/lib/types";
import { VERDICT_BANDS, describeEngine } from "@/lib/engine/assay";
import { PROTOCOL_VERSION, TOOLS } from "@/lib/mcp/server";
import { getSql } from "@/lib/db/sql";
import { ensureSchema } from "@/lib/db/schema";
import { ensureSeeded, listOrigins } from "@/lib/db/repository";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const ENGINE = describeEngine();

async function countClaims(): Promise<number> {
  try {
    const sql = await getSql();
    await ensureSchema(sql);
    await ensureSeeded(sql);
    const session = await getSession();
    const page = await listOrigins({
      sessionId: session.sessionId,
      includeReference: true,
      limit: 1,
      offset: 0,
    });
    return page.total;
  } catch {
    return 0;
  }
}

export default async function HomePage() {
  const claimCount = await countClaims();
  const readTools = TOOLS.filter((tool) => tool.annotations.readOnlyHint).length;
  const writeTools = TOOLS.length - readTools;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      {/* Masthead: left-ranged, ruled, no centred hero. */}
      <section className="border-b border-brass/25 pb-10">
        <p className="marginalia">est. 2026 · solana mainnet · no api key required</p>

        <h1 className="mt-4 max-w-3xl text-4xl leading-[1.05] tracking-tight text-bone sm:text-6xl">
          Prove which Solana token{" "}
          <span className="text-brass">came first</span>.
        </h1>

        <p className="mt-5 max-w-2xl text-base leading-relaxed text-bone-dim sm:text-lg">
          A public, hash-chained origin registry for token identities. Mintline decodes the on-chain
          metadata account, finds semantic collisions with an{" "}
          <strong className="font-medium text-bone">
            open-weight model that runs in your browser
          </strong>
          , and files every claim in a tamper-evident ledger anyone can replay.
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <a
            href="#press"
            className="border border-brass bg-brass px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-ink transition-colors hover:bg-brass-bright"
          >
            Assay a mint now
          </a>
          <Link
            href="/registry"
            className="border border-brass/40 px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-bone-dim transition-colors hover:border-brass hover:text-brass"
          >
            Open the registry
          </Link>
          <GitHubLink variant="hero" />
        </div>

        <dl className="mt-9 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-brass/20 pt-6 sm:grid-cols-4">
          <div>
            <dt className="marginalia">claims on file</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums text-bone">{claimCount}</dd>
          </div>
          <div>
            <dt className="marginalia">engine</dt>
            <dd className="mt-1 font-mono text-sm text-bone">{ENGINE.version}</dd>
          </div>
          <div>
            <dt className="marginalia">agent tools</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums text-bone">{TOOLS.length}</dd>
            <dd className="font-mono text-[0.7rem] text-bone-faint">
              {readTools} read · {writeTools} write
            </dd>
          </div>
          <div>
            <dt className="marginalia">mcp protocol</dt>
            <dd className="mt-1 font-mono text-sm text-bone">{PROTOCOL_VERSION}</dd>
          </div>
        </dl>
      </section>

      <div id="press" className="mt-10">
        <AssayPress sampleMints={SAMPLE_MINTS} />
      </div>

      {/* What it actually does: three concrete capabilities, not icon cards. */}
      <section className="mt-14">
        <h2 className="marginalia">what it does</h2>
        <div className="mt-5 grid gap-px bg-brass/15 sm:grid-cols-3">
          <article className="bg-ground p-5">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-brass">01 · decode</p>
            <h3 className="mt-2 text-lg text-bone">Reads the chain itself</h3>
            <p className="mt-2 text-sm leading-relaxed text-bone-dim">
              Derives the Metaplex metadata PDA for a mint with hand-rolled ed25519 curve maths,
              decodes the account, and reads supply and holder spread from the public Solana RPC. No
              indexer key, no wallet connection.
            </p>
          </article>
          <article className="bg-ground p-5">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-brass">02 · compare</p>
            <h3 className="mt-2 text-lg text-bone">Finds the collision</h3>
            <p className="mt-2 text-sm leading-relaxed text-bone-dim">
              A 22M-parameter sentence-embedding model loads in your browser and compares the token&apos;s
              identity text against every registered origin. The server&apos;s lexical comparator is
              always available as a deterministic floor.
            </p>
          </article>
          <article className="bg-ground p-5">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-brass">03 · seal</p>
            <h3 className="mt-2 text-lg text-bone">Files it where it can be checked</h3>
            <p className="mt-2 text-sm leading-relaxed text-bone-dim">
              Every create, verdict, re-assay and retirement appends to a SHA-384 chain per record.
              Replay recomputes every seal and names the first broken link.
            </p>
          </article>
        </div>
      </section>

      {/* The verdict bands, so the scoring is never a black box. */}
      <section className="mt-14">
        <h2 className="marginalia">how a score is read</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-bone-dim">
          Provenance integrity is a weighted sum of six factors. Weights are published in the API
          response and printed in every exported dossier.
        </p>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <caption className="sr-only">Provenance integrity bands and their required actions</caption>
            <thead>
              <tr className="border-b border-brass/30">
                <th scope="col" className="marginalia py-2 pr-4 text-left">
                  band
                </th>
                <th scope="col" className="marginalia py-2 pr-4 text-left">
                  score
                </th>
                <th scope="col" className="marginalia py-2 pr-4 text-left">
                  meaning
                </th>
                <th scope="col" className="marginalia py-2 text-left">
                  required action
                </th>
              </tr>
            </thead>
            <tbody>
              {VERDICT_BANDS.map((band) => (
                <tr key={band.verdict} className="ledger-row align-top">
                  <td className="py-3 pr-4 font-mono text-xs uppercase tracking-[0.1em] text-bone">
                    {band.label}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs tabular-nums text-brass">
                    {band.min}–{band.max}
                  </td>
                  <td className="py-3 pr-4 text-bone-dim">{band.summary}</td>
                  <td className="py-3 text-bone-dim">{band.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
          {ENGINE.weights.map((weight) => (
            <span key={weight.key} className="font-mono text-[0.72rem] text-bone-faint">
              {weight.label}{" "}
              <span className="text-brass">×{weight.weight.toFixed(2)}</span>
            </span>
          ))}
        </div>
      </section>

      {/* Agent surface. */}
      <section className="mt-14 border-t border-brass/25 pt-10">
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <h2 className="marginalia">agent interface</h2>
            <h3 className="mt-2 text-2xl text-bone">Scriptable over MCP</h3>
            <p className="mt-3 text-sm leading-relaxed text-bone-dim">
              {TOOLS.length} typed tools over JSON-RPC 2.0, including three that mutate through the
              same service layer the UI uses. Retrying an agent mutation with the same idempotency key
              does not create a duplicate.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/agent"
                className="border border-brass bg-brass px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-ink transition-colors hover:bg-brass-bright"
              >
                Open agent console
              </Link>
              <a
                href="/mcp.json"
                className="border border-brass/40 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-bone-dim transition-colors hover:border-brass hover:text-brass"
              >
                mcp.json
              </a>
            </div>
          </div>

          <div className="well p-4">
            <p className="marginalia">tools/list</p>
            <ul className="mt-2 space-y-1.5">
              {TOOLS.map((tool) => (
                <li key={tool.name} className="flex items-baseline gap-2">
                  <span
                    className={`font-mono text-[0.7rem] ${
                      tool.annotations.readOnlyHint ? "text-verdigris" : "text-brass"
                    }`}
                  >
                    {tool.annotations.readOnlyHint ? "read" : "write"}
                  </span>
                  <span className="font-mono text-[0.75rem] text-bone">{tool.name}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mt-14 border-t border-brass/25 pt-10">
        <p className="marginalia">safety</p>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-bone-dim">
          Mintline measures observable structure. It does not predict price, does not evaluate whether
          a token is a good investment, and is not financial advice. A high provenance score means an
          identity is not obviously impersonating another — it is not an endorsement of the project
          behind it. Verify anything that matters against the issuer directly.
        </p>
        <p className="mt-4 font-mono text-[0.72rem] text-bone-faint">
          engine {ENGINE_VERSION} · {SITE.name} is MIT licensed ·{" "}
          <a
            href={SITE.repositoryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brass underline underline-offset-4"
          >
            source on GitHub
          </a>
        </p>
      </section>
    </div>
  );
}