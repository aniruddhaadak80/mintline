"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { shortSeal, VERDICT_STYLE } from "./AssayPress";
import type { ClaimStatus, OriginRecord, Paginated } from "@/lib/types";

type Sort = "recent" | "score" | "name";
type Status = ClaimStatus | "all";

export interface RegistryFilterState {
  status: Status;
  sort: Sort;
  query: string;
  offset: number;
  mineOnly: boolean;
}

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: "recent", label: "Newest" },
  { value: "score", label: "Score" },
  { value: "name", label: "A–Z" },
];

const STATUSES: Array<{ value: Status; label: string }> = [
  { value: "all", label: "All" },
  { value: "registered", label: "Registered" },
  { value: "disputed", label: "Disputed" },
  { value: "retired", label: "Retired" },
];

/**
 * The registry workspace.
 *
 * Filtering, sorting and paging live in the URL and are executed by the server
 * component, so this client component holds no mirrored copy of the result set.
 * Navigation replaces the query string; the server re-renders and hands new data
 * down. That is why none of these controls needs an effect.
 */
export function RegistryWorkspace({
  initial,
  filters,
  pageSize,
}: {
  initial: Paginated<OriginRecord>;
  filters: RegistryFilterState;
  pageSize: number;
}) {
  const router = useRouter();

  // Only genuinely local UI state lives here.
  const [term, setTerm] = useState(filters.query);
  const [creating, setCreating] = useState(false);
  const [createState, setCreateState] = useState<
    | { phase: "idle" }
    | { phase: "saving" }
    | { phase: "done"; id: string }
    | { phase: "error"; message: string }
  >({ phase: "idle" });
  const [form, setForm] = useState({ name: "", symbol: "", mint: "" });
  const [note, setNote] = useState("");

  const navigate = (next: Partial<RegistryFilterState>) => {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams();
    if (merged.status !== "all") params.set("status", merged.status);
    if (merged.sort !== "recent") params.set("sort", merged.sort);
    if (merged.query) params.set("q", merged.query);
    if (merged.mineOnly) params.set("scope", "mine");
    const query = params.toString();
    router.replace(query ? `/registry?${query}` : "/registry", { scroll: false });
  };

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateState({ phase: "saving" });
    try {
      const response = await fetch("/api/origins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mint: form.mint.trim(),
          name: form.name.trim(),
          symbol: form.symbol.trim() || undefined,
          claimNote: note.trim() || undefined,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setCreateState({
          phase: "error",
          message: payload?.error?.message ?? `Failed (${response.status})`,
        });
        return;
      }
      setCreateState({ phase: "done", id: payload.origin.id });
      setForm({ name: "", symbol: "", mint: "" });
      setNote("");
      // Pull the freshly persisted row into the server-rendered ledger.
      router.refresh();
    } catch (caught) {
      setCreateState({
        phase: "error",
        message: caught instanceof Error ? caught.message : "Could not register the origin.",
      });
    }
  };

  const rows = initial.items;
  const pageStart = initial.total === 0 ? 0 : filters.offset + 1;
  const pageEnd = filters.offset + rows.length;
  const reference = initial.items.filter((item) => item.sessionId === "registry").length;

  return (
    <div className="space-y-8">
      {/* Filters: every control writes to the URL. */}
      <section aria-label="Filter the registry" className="specimen p-4">
        <div className="grid gap-4 md:grid-cols-[1fr_auto_auto_auto]">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              navigate({ query: term.trim(), offset: 0 });
            }}
            className="flex gap-2"
          >
            <label htmlFor="registry-q" className="sr-only">
              Search by name, ticker or mint
            </label>
            <input
              id="registry-q"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search name, ticker or mint"
              className="w-full border border-brass/30 bg-surface-sunken px-3 py-2 font-mono text-sm text-bone placeholder:text-bone-faint focus:border-brass focus:outline-none"
            />
            <button
              type="submit"
              className="border border-brass/50 px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-bone-dim hover:border-brass hover:text-brass"
            >
              Find
            </button>
          </form>

          <div>
            <label htmlFor="registry-status" className="sr-only">
              Status
            </label>
            <select
              id="registry-status"
              value={filters.status}
              onChange={(event) => navigate({ status: event.target.value as Status, offset: 0 })}
              className="w-full border border-brass/30 bg-surface-sunken px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-bone-dim focus:border-brass focus:outline-none"
            >
              {STATUSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="registry-sort" className="sr-only">
              Sort
            </label>
            <select
              id="registry-sort"
              value={filters.sort}
              onChange={(event) => navigate({ sort: event.target.value as Sort, offset: 0 })}
              className="w-full border border-brass/30 bg-surface-sunken px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-bone-dim focus:border-brass focus:outline-none"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-bone-dim">
              <input
                type="checkbox"
                checked={filters.mineOnly}
                onChange={(event) => navigate({ mineOnly: event.target.checked, offset: 0 })}
                className="h-3.5 w-3.5 accent-[#d9a441]"
              />
              Mine only
            </label>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="border border-brass/30 px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-bone-dim hover:border-brass hover:text-brass"
            >
              Refresh
            </button>
          </div>
        </div>

        <p className="marginalia mt-4" role="status" data-testid="registry-count">
          {initial.total} claim{initial.total === 1 ? "" : "s"} on file
          {reference > 0 ? ` · ${reference} reference` : ""}
          {filters.mineOnly ? " · this session only" : ""}
        </p>
      </section>

      {/* Create */}
      <section aria-label="Register an origin" className="specimen p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-mono text-sm uppercase tracking-[0.18em] text-brass">Register an origin</h2>
          <button
            type="button"
            onClick={() => setCreating((value) => !value)}
            aria-expanded={creating}
            className="font-mono text-xs uppercase tracking-[0.12em] text-bone-dim underline underline-offset-4 hover:text-brass"
          >
            {creating ? "Hide" : "Show"}
          </button>
        </div>

        {creating ? (
          <form onSubmit={submitCreate} className="mt-4 grid gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="create-mint" className="marginalia">
                  mint address
                </label>
                <input
                  id="create-mint"
                  required
                  value={form.mint}
                  onChange={(event) => setForm({ ...form, mint: event.target.value })}
                  placeholder="Base58 Solana address"
                  spellCheck={false}
                  className="mt-1 w-full border border-brass/30 bg-surface-sunken px-3 py-2 font-mono text-sm text-bone placeholder:text-bone-faint focus:border-brass focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="create-name" className="marginalia">
                  origin name
                </label>
                <input
                  id="create-name"
                  required
                  maxLength={80}
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Name you are claiming"
                  className="mt-1 w-full border border-brass/30 bg-surface-sunken px-3 py-2 text-sm text-bone placeholder:text-bone-faint focus:border-brass focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="create-symbol" className="marginalia">
                  ticker
                </label>
                <input
                  id="create-symbol"
                  maxLength={24}
                  value={form.symbol}
                  onChange={(event) => setForm({ ...form, symbol: event.target.value })}
                  placeholder="Optional"
                  className="mt-1 w-full border border-brass/30 bg-surface-sunken px-3 py-2 font-mono text-sm text-bone placeholder:text-bone-faint focus:border-brass focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="create-note" className="marginalia">
                claim note
              </label>
              <textarea
                id="create-note"
                rows={2}
                maxLength={600}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Why does this identity belong to this mint?"
                className="mt-1 w-full resize-y border border-brass/30 bg-surface-sunken px-3 py-2 text-sm text-bone placeholder:text-bone-faint focus:border-brass focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={createState.phase === "saving"}
                data-testid="create-submit"
                className="border border-brass bg-brass px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-ink transition-colors hover:bg-brass-bright disabled:opacity-50"
              >
                {createState.phase === "saving" ? "Assaying and filing…" : "Register origin"}
              </button>

              {createState.phase === "done" ? (
                <p className="font-mono text-xs text-verdigris" role="status" data-testid="create-success">
                  Filed and sealed.{" "}
                  <Link
                    href={`/registry/${createState.id}`}
                    className="text-brass underline underline-offset-4"
                  >
                    Open the specimen
                  </Link>
                </p>
              ) : null}

              {createState.phase === "error" ? (
                <p className="font-mono text-xs text-oxide-bright" role="alert" data-testid="create-error">
                  {createState.message}
                </p>
              ) : null}
            </div>

            <p className="font-mono text-[0.7rem] leading-relaxed text-bone-faint">
              The assay runs server-side against live chain data before anything is stored, so a filed
              claim can never carry a score you typed yourself.
            </p>
          </form>
        ) : null}
      </section>

      {/* Ledger */}
      <section aria-label="Registered origins">
        {rows.length === 0 ? (
          <div className="specimen p-8 text-center">
            <p className="marginalia">empty ledger</p>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-bone-dim">
              No origin claims match these filters. Register one above, or clear the filters to see the
              reference registry.
            </p>
            <button
              type="button"
              onClick={() => {
                setTerm("");
                router.replace("/registry", { scroll: false });
              }}
              className="mt-4 font-mono text-xs uppercase tracking-[0.12em] text-brass underline underline-offset-4"
            >
              Clear filters
            </button>
          </div>
        ) : null}

        <ul className="specimen divide-y divide-brass/12">
          {rows.map((origin) => {
            const verdict = origin.assay?.verdict ?? null;
            const style = verdict ? VERDICT_STYLE[verdict] : null;
            return (
              <li key={origin.id} className="ledger-row ledger-row-hover">
                <Link
                  href={`/registry/${origin.id}`}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-bone">
                      {origin.name}
                      {origin.symbol ? (
                        <span className="ml-2 font-mono text-xs text-bone-faint">{origin.symbol}</span>
                      ) : null}
                      {origin.sessionId === "registry" ? (
                        <span className="ml-2 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-verdigris">
                          reference
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 break-all font-mono text-[0.7rem] text-bone-faint">{origin.mint}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-4">
                    <span className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-bone-faint">
                      {origin.status}
                      {origin.deletedAt ? " · tombstone" : ""}
                    </span>
                    {style ? (
                      <span className={`font-mono text-[0.68rem] uppercase tracking-[0.1em] ${style.color}`}>
                        {style.label}
                      </span>
                    ) : (
                      <span className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-bone-faint">
                        not assayed
                      </span>
                    )}
                    <span className="w-16 text-right font-mono text-sm tabular-nums text-brass">
                      {origin.assay ? origin.assay.score.toFixed(1) : "—"}
                    </span>
                    <span className="hidden w-28 text-right font-mono text-[0.65rem] text-bone-faint lg:block">
                      {shortSeal(origin.chainHead)}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>

        {initial.total > pageSize ? (
          <div className="mt-4 flex items-center justify-between">
            <p className="font-mono text-xs text-bone-faint">
              showing {pageStart}–{pageEnd} of {initial.total}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={filters.offset === 0}
                onClick={() => navigate({ offset: Math.max(0, filters.offset - pageSize) })}
                className="border border-brass/30 px-3 py-1.5 font-mono text-xs text-bone-dim hover:border-brass hover:text-brass disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={filters.offset + rows.length >= initial.total}
                onClick={() => navigate({ offset: filters.offset + pageSize })}
                className="border border-brass/30 px-3 py-1.5 font-mono text-xs text-bone-dim hover:border-brass hover:text-brass disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}