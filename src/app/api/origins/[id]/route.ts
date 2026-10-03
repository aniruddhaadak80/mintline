import { getSession, sessionCookieHeader, rateLimit } from "@/lib/session";
import {
  getOrigin,
  getChainEvents,
  recordVerdict,
  retireOrigin,
  saveAssay,
} from "@/lib/db/repository";
import { assayMint } from "@/lib/service/assay-service";
import {
  handleError,
  notFoundResponse,
  optionalString,
  requireObject,
  requireStatus,
  requireString,
  LIMITS,
} from "@/lib/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Read one claim. A record in another session is reported as absent, not forbidden. */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const originId = requireString(id, "id", { max: 64 });
    const session = await getSession();

    const origin = await getOrigin(session.sessionId, originId);
    if (!origin) return notFoundResponse();

    const url = new URL(request.url);
    const includeChain = url.searchParams.get("chain") === "true";

    const headers = new Headers({ "cache-control": "no-store" });
    if (session.isNew) headers.append("set-cookie", sessionCookieHeader(session.value));

    if (!includeChain) {
      return Response.json({ origin }, { headers });
    }

    const events = await getChainEvents(session.sessionId, originId);

    return Response.json({ origin, events }, { headers });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Update a claim.
 *
 * `status` records a human decision; `reassay` re-runs the engine against live
 * data and stores the new result. Both append a sealed audit event.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const originId = requireString(id, "id", { max: 64 });
    const session = await getSession();

    const limit = rateLimit(`patch:${session.sessionId}`, 60, 60);
    if (!limit.allowed) {
      return Response.json(
        { error: { code: "rate_limited", message: "Too many updates from this session." } },
        { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
      );
    }

    const existing = await getOrigin(session.sessionId, originId);
    if (!existing) return notFoundResponse();

    const body = requireObject(await request.json().catch(() => ({})));

    const headers = new Headers({ "cache-control": "no-store" });
    if (session.isNew) headers.append("set-cookie", sessionCookieHeader(session.value));

    let updated = existing;
    const applied: string[] = [];

    if (body.status !== undefined) {
      const status = requireStatus(body.status);
      const note = optionalString(body.note, "note", { max: LIMITS.noteMax });
      updated = await recordVerdict(
        session.sessionId,
        originId,
        status,
        note,
        optionalString(body.idempotencyKey, "idempotencyKey", { max: 120 }),
      );
      applied.push("status");
    }

    if (body.reassay === true) {
      const outcome = await assayMint({ sessionId: session.sessionId, mint: existing.mint });
      updated = await saveAssay(session.sessionId, originId, outcome.result);
      applied.push("reassay");
    }

    if (applied.length === 0) {
      return Response.json(
        {
          error: {
            code: "no_op",
            message: "Provide `status` to record a verdict, or `reassay: true` to recompute the assay.",
          },
        },
        { status: 400, headers },
      );
    }

    return Response.json(
      { origin: updated, applied, chainHead: updated.chainHead, eventCount: updated.eventCount },
      { headers },
    );
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Retire a claim.
 *
 * Soft delete: the row survives as a tombstone so the audit chain can still be
 * replayed, which is the whole point of the chain.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const originId = requireString(id, "id", { max: 64 });
    const session = await getSession();

    const limit = rateLimit(`delete:${session.sessionId}`, 30, 60);
    if (!limit.allowed) {
      return Response.json(
        { error: { code: "rate_limited", message: "Too many deletions from this session." } },
        { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
      );
    }

    const retired = await retireOrigin(session.sessionId, originId);

    // Prove the tombstone is still replayable rather than asserting it.
    const events = await getChainEvents(session.sessionId, originId);

    const headers = new Headers({ "cache-control": "no-store" });
    if (session.isNew) headers.append("set-cookie", sessionCookieHeader(session.value));

    return Response.json(
      {
        origin: retired,
        tombstone: true,
        replayable: events.length > 0,
        eventCount: events.length,
        chainHead: retired.chainHead,
      },
      { headers },
    );
  } catch (error) {
    return handleError(error);
  }
}