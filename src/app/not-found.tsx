import Link from "next/link";
import { SITE } from "@/lib/config";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-3xl flex-col justify-center px-4 py-16 sm:px-6">
      <p className="marginalia">404 · no such specimen</p>
      <h1 className="mt-3 text-4xl text-bone sm:text-5xl">Not on file.</h1>
      <p className="mt-4 max-w-xl text-sm leading-relaxed text-bone-dim">
        This record does not exist, or it belongs to a different anonymous session. Mintline answers
        both cases identically on purpose, so a share link cannot be used to probe for other
        people&apos;s claims.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/"
          className="border border-brass bg-brass px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-ink transition-colors hover:bg-brass-bright"
        >
          Back to the press
        </Link>
        <Link
          href="/registry"
          className="border border-brass/40 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-bone-dim transition-colors hover:border-brass hover:text-brass"
        >
          Open the registry
        </Link>
        <a
          href={SITE.repositoryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="border border-brass/40 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-bone-dim transition-colors hover:border-brass hover:text-brass"
        >
          View source
        </a>
      </div>
    </div>
  );
}