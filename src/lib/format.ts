/**
 * Display formatting.
 *
 * Isomorphic on purpose: these run in server components, in client components
 * and inside the dossier generator, and they must never pull `node:crypto` into
 * a browser bundle.
 */

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

/** Short, quotable form of a hex seal. */
export function shortSeal(seal: string | null | undefined): string {
  if (!seal) return "—";
  return `${seal.slice(0, 10)}…${seal.slice(-6)}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Date(parsed).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export function formatAge(days: number | null | undefined): string {
  if (days === null || days === undefined || !Number.isFinite(days)) return "—";
  if (days < 1) return "under a day";
  if (days < 60) return `${days.toFixed(0)} days`;
  return `${(days / 30.44).toFixed(1)} months`;
}