/**
 * Single site configuration.
 *
 * The repository URL and the live URL are declared here and nowhere else. The
 * header, the mobile menu, the landing CTA and the footer all import from this
 * module, so there is no way for one surface to link somewhere the others do
 * not.
 */

export const SITE = {
  name: "Mintline",
  /** One-line outcome, used in metadata and on the landing page. */
  tagline: "Prove which Solana token came first.",
  description:
    "A public, hash-chained origin registry for Solana token identities. Mintline decodes on-chain metadata, finds semantic collisions with an open-weight model that runs in your browser, and records every claim in a tamper-evident ledger anyone can replay.",
  /**
   * Canonical origin for metadata, OpenGraph, sitemap and share links.
   *
   * Overridden at build time by `NEXT_PUBLIC_SITE_URL`. The fallback below is the
   * verified production alias of this project's deployment — `mintline.vercel.app`
   * belongs to an unrelated project, so it must never be assumed.
   */
  liveUrl:
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://mintline-eight.vercel.app",
  repositoryUrl: "https://github.com/aniruddhaadak80/mintline",
  issuesUrl: "https://github.com/aniruddhaadak80/mintline/issues",
  license: "MIT",
  author: "Aniruddha Adak",
} as const;

export const NAV_LINKS = [
  { href: "/registry", label: "Registry" },
  { href: "/assay", label: "Assay" },
  { href: "/chain", label: "Chain" },
  { href: "/agent", label: "Agent" },
  { href: "/export", label: "Export" },
  { href: "/settings", label: "Settings" },
] as const;

/** Label shown on the GitHub control. Repeated in one place, not four. */
export const REPO_CTA = {
  label: "View source",
  shortLabel: "GitHub",
  accessibleLabel: `View the ${SITE.name} source on GitHub`,
} as const;

export const API_ROUTES = {
  health: "/api/health",
  origins: "/api/origins",
  assay: "/api/assay",
  mint: "/api/mint",
  integrity: "/api/integrity/replay",
  mcp: "/api/mcp",
  export: "/api/export",
} as const;

export function absoluteUrl(path: string): string {
  return `${SITE.liveUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Shown in the footer and the landing CTA. */
export const FOOTER_LINKS = [
  { href: "/registry", label: "Registry" },
  { href: "/assay", label: "Assay lab" },
  { href: "/chain", label: "Chain replay" },
  { href: "/agent", label: "Agent console" },
  { href: "/export", label: "Dossier export" },
  { href: "/settings", label: "Settings" },
] as const;