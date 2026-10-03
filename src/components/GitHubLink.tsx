import { REPO_CTA, SITE } from "@/lib/config";

/**
 * The repository control.
 *
 * Every surface that links to GitHub renders this component, so the URL, the
 * accessible label and the external-link attributes are defined once. The icon
 * is the official GitHub mark inlined as SVG, because `lucide-react` ships
 * `Github` but inlining removes any doubt about which glyph is shown and keeps
 * the mark recognisable at 16px.
 */
export function GitHubMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function GitHubLink({
  variant = "nav",
  className = "",
}: {
  variant?: "nav" | "footer" | "hero";
  className?: string;
}) {
  const base =
    "group inline-flex items-center gap-2 font-mono uppercase tracking-[0.14em] transition-colors duration-150";

  const styles =
    variant === "hero"
      ? `${base} border border-brass/50 bg-brass/10 px-5 py-3 text-sm text-brass hover:bg-brass hover:text-ink`
      : variant === "footer"
        ? `${base} text-bone-dim hover:text-brass`
        : `${base} border border-brass/30 px-3 py-1.5 text-xs text-bone-dim hover:border-brass hover:text-brass`;

  return (
    <a
      href={SITE.repositoryUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={REPO_CTA.accessibleLabel}
      title={`${REPO_CTA.accessibleLabel} — ${SITE.repositoryUrl}`}
      className={`${styles} ${className}`}
      data-testid="repo-link"
    >
      <GitHubMark />
      <span>{variant === "hero" ? "Star on GitHub" : REPO_CTA.label}</span>
    </a>
  );
}