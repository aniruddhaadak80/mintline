import type { Metadata } from "next";
import { RegistryWorkspace, type RegistryFilterState } from "@/components/RegistryWorkspace";
import { getSql } from "@/lib/db/sql";
import { ensureSchema } from "@/lib/db/schema";
import { ensureSeeded, listOrigins } from "@/lib/db/repository";
import { getSession } from "@/lib/session";
import { optionalQuery } from "@/lib/validation";
import type { ClaimStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Registry",
  description:
    "Every origin claim on file: the reference registry plus claims registered in this browser session. Filter, sort and inspect the ledger.",
};

export const REGISTRY_PAGE_SIZE = 20;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Filter, sort and paging are resolved on the server from the URL query.
 *
 * That is what makes a view shareable and refresh-safe, and it means the client
 * component never has to mirror server state inside an effect.
 */
export function readFilters(params: URLSearchParams): RegistryFilterState {
  const status = params.get("status");
  const sort = params.get("sort");

  return {
    status:
      status === "registered" || status === "disputed" || status === "retired" || status === "all"
        ? status
        : "all",
    sort: sort === "score" || sort === "name" ? sort : "recent",
    query: optionalQuery(params.get("q")) ?? "",
    offset: Math.max(0, Number(params.get("offset") ?? "0") || 0),
    mineOnly: params.get("scope") === "mine",
  };
}

export default async function RegistryPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.set(key, value);
  }

  const filters = readFilters(params);

  const sql = await getSql();
  await ensureSchema(sql);
  await ensureSeeded(sql);
  const session = await getSession();

  const page = await listOrigins({
    sessionId: session.sessionId,
    includeReference: !filters.mineOnly,
    status: filters.status as ClaimStatus | "all",
    query: filters.query,
    sort: filters.sort,
    limit: REGISTRY_PAGE_SIZE,
    offset: filters.offset,
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="border-b border-brass/25 pb-6">
        <p className="marginalia">ledger</p>
        <h1 className="mt-2 text-3xl text-bone sm:text-4xl">Origin registry</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-bone-dim">
          The reference registry is compiled by Mintline and visible to everyone. Claims you register
          belong to this browser session only — there are no accounts, and the session is carried by an
          HTTP-only signed cookie.
        </p>
      </header>

      <div className="mt-8">
        <RegistryWorkspace initial={page} filters={filters} pageSize={REGISTRY_PAGE_SIZE} />
      </div>
    </div>
  );
}