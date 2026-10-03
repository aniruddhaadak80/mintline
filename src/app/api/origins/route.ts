import { getSession, sessionCookieHeader, rateLimit } from "@/lib/session";
import { getSql } from "@/lib/db/sql";
import { ensureSchema } from "@/lib/db/schema";
import {
  ensureSeeded,
  listOrigins,
  registerOrigin,
  type ListOptions,
} from "@/lib/db/repository";
import { assayMint } from "@/lib/service/assay-service";
import { isValidSolanaAddress } from "@/lib/solana/address";
import { SAMPLE_MINTS } from "@/lib/solana/fallback";
import {
  boundedInt,
  handleError,
  optionalIsoDate,
  optionalQuery,
  optionalString,
  requireMint,
  requireObject,
  requireString,
  LIMITS,
} from "@/lib/validation";
import type { ClaimStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const WRITE_LIMIT = 30;
const WRITE_WINDOW_SECONDS = 60;

function readSort(value: string | null): ListOptions["sort"] {
  return value === "score" || value === "name" ? value : "recent";
}

function readStatus(value: string | null): ClaimStatus | "all" {
  return value === "registered" || value === "disputed" || value === "retired" || value === "all"
    ? value
    : "all";
}

/** List claims visible to this session, including the shared reference registry. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const session = await getSession();

    const sql = await getSql();
    await ensureSchema(sql);
    await ensureSeeded(sql);

    const page = await listOrigins({
      sessionId: session.sessionId,
      includeReference: url.searchParams.get("include_reference") !== "false",
      status: readStatus(url.searchParams.get("status")),
      query: optionalQuery(url.searchParams.get("q")),
      sort: readSort(url.searchParams.get("sort")),
      limit: boundedInt(url.searchParams.get("limit"), "limit", {
        min: 1,
        max: LIMITS.limitMax,
        fallback: 25,
      }),
      offset: boundedInt(url.searchParams.get("offset"), "offset", { min: 0, max: 100_000, fallback: 0 }),
    });

    const headers = new Headers({ "cache-control": "no-store" });
    if (session.isNew) headers.append("set-cookie", sessionCookieHeader(session.value));

    return Response.json({ ...page, sampleMints: SAMPLE_MINTS }, { headers });
  } catch (error) {
    return handleError(error);
  }
}

export interface CreateOriginBody {
  mint: string;
  name: string;
  symbol?: string | null;
  description?: string | null;
  claimNote?: string | null;
  claimedAt?: string | null;
  idempotencyKey?: string | null;
  matchSymbol?: boolean;
}

/**
 * Register a claim.
 *
 * The assay is computed server-side from live chain data, so a stored record can
 * never contain a score the client made up. `name` is the only identity input
 * taken from the client; everything else is read from the chain when available.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();

    const limit = rateLimit(`create:${session.sessionId}`, WRITE_LIMIT, WRITE_WINDOW_SECONDS);
    if (!limit.allowed) {
      return Response.json(
        {
          error: {
            code: "rate_limited",
            message: "Too many claims from this session. Try again shortly.",
            details: { retryAfterSeconds: limit.retryAfterSeconds, scope: limit.scope },
          },
        },
        {
          status: 429,
          headers: {
            "cache-control": "no-store",
            "retry-after": String(limit.retryAfterSeconds),
          },
        },
      );
    }

    const body = requireObject(await request.json().catch(() => ({}))) as unknown as CreateOriginBody;

    const mint = requireMint(body.mint);
    const name = requireString(body.name, "name", { max: LIMITS.nameMax });
    const claimNote = optionalString(body.claimNote, "claimNote", { max: LIMITS.noteMax });
    const claimedAt = optionalIsoDate(body.claimedAt, "claimedAt");
    const idempotencyKey = optionalString(body.idempotencyKey, "idempotencyKey", { max: 120 });

    const outcome = await assayMint({
      sessionId: session.sessionId,
      mint,
      matchSymbol: body.matchSymbol ?? true,
    });

    const registered = await registerOrigin({
      sessionId: session.sessionId,
      mint,
      name,
      symbol:
        outcome.facts.metadata?.symbol ?? optionalString(body.symbol, "symbol", { max: LIMITS.symbolMax }),
      description:
        outcome.facts.metadata?.description ??
        optionalString(body.description, "description", { max: LIMITS.descriptionMax }),
      claimNote,
      claimedAt: claimedAt ?? undefined,
      assay: outcome.result,
      idempotencyKey,
    });

    const headers = new Headers({ "cache-control": "no-store" });
    if (session.isNew) headers.append("set-cookie", sessionCookieHeader(session.value));

    return Response.json(
      {
        origin: registered.origin,
        created: registered.created,
        score: outcome.result.score,
        verdict: outcome.result.verdict,
        comparator: outcome.similarity.method,
        collisions: outcome.existingClaims,
        mintValid: isValidSolanaAddress(mint),
      },
      { status: registered.created ? 201 : 200, headers },
    );
  } catch (error) {
    return handleError(error);
  }
}