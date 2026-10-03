import type { Metadata } from "next";
import { SAMPLE_MINTS } from "@/lib/solana/fallback";
import { SOURCE_INFO } from "@/lib/solana/live";
import { LEXICAL_MODEL_ID } from "@/lib/engine/similarity";
import {
  EMBEDDING_DOWNLOAD_HINT,
  EMBEDDING_LICENSE,
  EMBEDDING_MODEL_ID,
  EMBEDDING_PARAMETERS,
} from "@/lib/engine/model-info";
import { ENGINE_VERSION } from "@/lib/types";
import { GENESIS_SALT, GENESIS_SEAL } from "@/lib/integrity/chain";
import { TOOLS, PROTOCOL_VERSION } from "@/lib/mcp/server";
import { checkStore, listOrigins } from "@/lib/db/repository";
import { getSession } from "@/lib/session";
import { SITE } from "@/lib/config";
import { LIMITS } from "@/lib/validation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings and method",
  description:
    "How Mintline is configured: persistence adapters, live sources with attribution, both comparators, the seal rule, validation limits and the security model.",
};

export default async function SettingsPage() {
  const store = await checkStore();
  const session = await getSession();
  const page = await listOrigins({
    sessionId: session.sessionId,
    includeReference: true,
    limit: 1,
    offset: 0,
  });

  const rows: Array<[string, string]> = [
    ["Persistence (production)", "Neon Postgres via the Vercel integration. `DATABASE_URL` must be set; `/api/health` fails the deployment if it is not."],
    ["Persistence (local)", "Embedded PGlite in `.mintline-data`, or in-memory when the directory is unwritable. Selected only when `DATABASE_URL` is absent."],
    ["Chain metadata", "Solana public RPC. `getAccountInfo` on the derived Metaplex PDA, `getTokenSupply`, and `getTokenLargestAccounts` on a best-effort basis."],
    ["Market structure", "DexScreener `/latest/dex/tokens/{mint}` for pairs, liquidity, volume and creation time."],
    ["Price corroboration", "Jupiter lite price API v3, compared against DexScreener to surface divergence between two independent readings."],
    ["Off-chain metadata", "The JSON at the token's `uri`, fetched only from an allow-list of IPFS/Arweave/NFT-S.Storage hosts over HTTPS."],
    ["Server comparator", `${LEXICAL_MODEL_ID}. Deterministic, no model, no network.`],
    ["Browser comparator", `${EMBEDDING_MODEL_ID} — ${EMBEDDING_PARAMETERS} parameters, ${EMBEDDING_LICENSE}, ${EMBEDDING_DOWNLOAD_HINT}.`],
    ["Engine", `${ENGINE_VERSION}. Six weighted factors summing to 1.00, published in every response.`],
    ["Chain rule", `genesis = SHA-384(UTF-8("${GENESIS_SALT}")); seal(n) = SHA-384(UTF-8(seal(n-1)) || canonicalJson(event(n))).`],
    ["Agent interface", `JSON-RPC 2.0 at ${SITE.liveUrl}/api/mcp, protocol ${PROTOCOL_VERSION}, ${TOOLS.length} tools.`],
    ["Auth", "None. A signed, HTTP-only, SameSite=Lax cookie carries an unguessable session id. Reads and writes are scoped by it; another session gets 404, not 403."],
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="border-b border-brass/25 pb-6">
        <p className="marginalia">configuration &amp; method</p>
        <h1 className="mt-2 text-3xl text-bone sm:text-4xl">Settings</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-bone-dim">
          Every value that decides what Mintline reports, and where it came from. Nothing on this page
          is a preference you can toggle — it is the actual configuration this deployment is running.
        </p>
      </header>

      {/* Live status */}
      <section className="mt-8 grid gap-px bg-brass/15 sm:grid-cols-3">
        <div className="bg-ground p-4">
          <p className="marginalia">storage adapter</p>
          <p
            className={`mt-1 font-mono text-lg ${store.ok ? "text-verdigris" : "text-oxide-bright"}`}
            data-testid="store-adapter"
          >
            {store.adapter}
          </p>
          <p className="mt-1 font-mono text-[0.68rem] text-bone-faint">
            {store.ok ? `round trip ${store.roundTripMs}ms` : (store.error ?? "unreachable")}
          </p>
        </div>
        <div className="bg-ground p-4">
          <p className="marginalia">claims visible</p>
          <p className="mt-1 font-mono text-lg tabular-nums text-bone">{page.total}</p>
          <p className="mt-1 font-mono text-[0.68rem] text-bone-faint">this session + reference</p>
        </div>
        <div className="bg-ground p-4">
          <p className="marginalia">session scope</p>
          <p className="mt-1 truncate font-mono text-xs text-bone-faint">{session.sessionId}</p>
          <p className="mt-1 font-mono text-[0.68rem] text-bone-faint">signed, HTTP-only cookie</p>
        </div>
      </section>

      {/* Config table */}
      <section className="mt-10">
        <h2 className="marginalia">how this deployment is wired</h2>
        <div className="scroller mt-4">
          <table className="w-full min-w-[42rem] border-collapse text-sm">
            <caption className="sr-only">Configuration and method reference</caption>
            <thead>
              <tr className="border-b border-brass/30">
                <th scope="col" className="marginalia py-2 pr-4 text-left">concern</th>
                <th scope="col" className="marginalia py-2 text-left">implementation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label} className="ledger-row align-top">
                  <td className="py-3 pr-4 font-mono text-xs uppercase tracking-[0.1em] text-bone">
                    {label}
                  </td>
                  <td className="py-3 leading-relaxed text-bone-dim">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Live sources */}
      <section className="mt-10">
        <h2 className="marginalia">live sources</h2>
        <ul className="mt-4 grid gap-2 sm:grid-cols-3">
          {[SOURCE_INFO.solanaRpc, SOURCE_INFO.dexscreener, SOURCE_INFO.jupiter].map((source) => (
            <li key={source.id} className="specimen p-4">
              <a
                href={source.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-bone underline decoration-brass/40 underline-offset-4 hover:text-brass"
              >
                {source.label}
              </a>
              <p className="mt-1 break-all font-mono text-[0.65rem] text-bone-faint">{source.endpoint}</p>
              <p className="mt-2 font-mono text-[0.65rem] text-verdigris">no api key</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 font-mono text-[0.7rem] leading-relaxed text-bone-faint">
          When every source is unreachable, mints that have a sealed sample return that sample with{" "}
          <code className="text-oxide-bright">status: &quot;fallback&quot;</code> and the capture timestamp.
          Fallback never replaces a stored claim.
        </p>
      </section>

      {/* Validation limits */}
      <section className="mt-10">
        <h2 className="marginalia">validation limits</h2>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(LIMITS).map(([key, value]) => (
            <li key={key} className="border border-brass/20 px-3 py-2">
              <p className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-bone-faint">
                {key.replace(/([A-Z])/g, " $1").toLowerCase()}
              </p>
              <p className="mt-0.5 font-mono text-sm tabular-nums text-brass">{value}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Security */}
      <section className="mt-10 grid gap-6 md:grid-cols-2">
        <div className="specimen p-5">
          <h2 className="marginalia">security model</h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-bone-dim">
            <li>· All SQL is parameterized; no string interpolation of user input into a query.</li>
            <li>· Every write is scoped to a signed session id and validated before it reaches SQL.</li>
            <li>· Error responses never include stack traces, SQL or environment values.</li>
            <li>· Metadata JSON is fetched only from an HTTPS host allow-list, with a size and time cap.</li>
            <li>· Rate limits are a fixed window held in process memory. On serverless this is per
              instance, so it stops casual scripting, not a determined flood. A global limit needs a
              hosted store.</li>
            <li>· No secrets ship to the client; the browser model runs locally and sends nothing back.</li>
          </ul>
        </div>

        <div className="specimen p-5">
          <h2 className="marginalia">try the sealed samples</h2>
          <p className="mt-3 text-sm leading-relaxed text-bone-dim">
            These mints have a dated offline fixture, so the app stays usable if the chain or the
            indexers are down.
          </p>
          <ul className="mt-3 space-y-2">
            {SAMPLE_MINTS.map((sample) => (
              <li key={sample.mint} className="border-b border-brass/12 pb-2 last:border-0">
                <Link
                  href={`/assay?mint=${sample.mint}`}
                  className="font-mono text-xs text-bone underline decoration-brass/40 underline-offset-4 hover:text-brass"
                >
                  {sample.symbol} — {sample.label}
                </Link>
                <p className="mt-0.5 break-all font-mono text-[0.65rem] text-bone-faint">{sample.mint}</p>
              </li>
            ))}
          </ul>
          <p className="marginalia mt-4 break-all">genesis {GENESIS_SEAL}</p>
        </div>
      </section>

      <section className="mt-10 border-t border-brass/25 pt-6">
        <h2 className="marginalia">disclaimer</h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-bone-dim">
          Mintline measures observable structure: name collisions, metadata completeness, market depth,
          holder concentration and trading age. It does not predict price, does not evaluate whether a
          token is a good investment, and is not financial advice. A high provenance score means an
          identity is not obviously impersonating another; it is not an endorsement of the project behind
          it. Verify anything that matters against the issuer directly.
        </p>
      </section>
    </div>
  );
}