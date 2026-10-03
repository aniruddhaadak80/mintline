"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV_LINKS, SITE } from "@/lib/config";
import { GitHubLink } from "./GitHubLink";

/**
 * Shared navigation.
 *
 * Desktop bar and mobile sheet render the same link list, so a route can never
 * be reachable on one breakpoint and missing on the other.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Closing on navigation is handled where navigation happens (the links), not
  // in an effect that would re-render after every route change.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-50 border-b border-brass/25 bg-ground/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/"
          onClick={() => setOpen(false)}
          className="group flex items-baseline gap-2"
          aria-label={`${SITE.name} home`}
        >
          <span className="font-mono text-lg font-bold tracking-[0.2em] text-brass">MINTLINE</span>
          <span className="hidden text-[0.65rem] font-mono uppercase tracking-[0.18em] text-bone-faint sm:inline">
            origin registry
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={`px-3 py-1.5 font-mono text-xs uppercase tracking-[0.12em] transition-colors ${
                isActive(link.href)
                  ? "border-b border-brass text-brass"
                  : "text-bone-dim hover:text-bone"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <GitHubLink variant="nav" className="hidden sm:inline-flex" />

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            className="border border-brass/30 p-2 text-bone-dim transition-colors hover:border-brass hover:text-brass md:hidden"
          >
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              {open ? (
                <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.6" />
              ) : (
                <path d="M2 5h14M2 9h14M2 13h14" stroke="currentColor" strokeWidth="1.6" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {open ? (
        <div id="mobile-nav" className="border-t border-brass/25 bg-ground md:hidden">
          <nav aria-label="Mobile" className="mx-auto max-w-6xl px-4 py-3">
            <ul className="flex flex-col">
              {NAV_LINKS.map((link) => (
                <li key={link.href} className="ledger-row">
                  <Link
                    href={link.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive(link.href) ? "page" : undefined}
                    className={`block py-3 font-mono text-sm uppercase tracking-[0.12em] ${
                      isActive(link.href) ? "text-brass" : "text-bone-dim"
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="pt-4 sm:hidden">
              <GitHubLink variant="nav" />
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}