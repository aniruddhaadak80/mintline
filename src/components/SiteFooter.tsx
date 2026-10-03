import Link from "next/link";
import { API_ROUTES, FOOTER_LINKS, SITE } from "@/lib/config";
import { GitHubLink } from "./GitHubLink";
import { SAFETY_DISCLAIMER } from "@/lib/export/dossier";

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-brass/25 bg-ground-deep">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <p className="font-mono text-sm font-bold tracking-[0.2em] text-brass">MINTLINE</p>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-bone-dim">{SITE.tagline}</p>
            <p className="mt-3 max-w-md text-xs leading-relaxed text-bone-faint">
              A hash-chained origin registry for Solana token identities. No wallet, no API key, no
              server-side inference.
            </p>
            <div className="mt-5">
              <GitHubLink variant="footer" />
            </div>
          </div>

          <nav aria-label="Footer">
            <p className="marginalia">Product</p>
            <ul className="mt-3 space-y-2">
              {FOOTER_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-bone-dim transition-colors hover:text-brass"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Reference">
            <p className="marginalia">Reference</p>
            <ul className="mt-3 space-y-2">
              <li>
                <Link
                  href={API_ROUTES.health}
                  className="text-sm text-bone-dim transition-colors hover:text-brass"
                >
                  Health check
                </Link>
              </li>
              <li>
                <Link
                  href={API_ROUTES.mcp}
                  className="text-sm text-bone-dim transition-colors hover:text-brass"
                >
                  MCP endpoint
                </Link>
              </li>
              <li>
                <a
                  href="/mcp.json"
                  className="text-sm text-bone-dim transition-colors hover:text-brass"
                >
                  mcp.json
                </a>
              </li>
              <li>
                <a
                  href={SITE.issuesUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-bone-dim transition-colors hover:text-brass"
                >
                  Issues
                </a>
              </li>
              <li>
                <a
                  href={`${SITE.repositoryUrl}/blob/main/LICENSE`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-bone-dim transition-colors hover:text-brass"
                >
                  MIT license
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-10 border-t border-brass/15 pt-6">
          <p className="marginalia">Disclaimer</p>
          <p className="mt-2 max-w-4xl text-xs leading-relaxed text-bone-faint">
            {SAFETY_DISCLAIMER}
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-2 border-t border-brass/15 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-bone-faint">
            {SITE.name} · MIT · built by {SITE.author}
          </p>
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-bone-faint">
            Chain data: Solana RPC · DexScreener · Jupiter
          </p>
        </div>
      </div>
    </footer>
  );
}