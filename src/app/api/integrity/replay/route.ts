import { getSession } from "@/lib/session";
import { listOrigins, replayOrigin } from "@/lib/db/repository";
import { handleError, notFoundResponse, optionalQuery, requireString } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * Chain replay.
 *
 * With `?id=`, replays one origin. Without it, replays every claim visible to
 * the caller and reports the first broken link across the whole set. Replay
 * recomputes every seal from the genesis, so a tampered row is detected here
 * rather than trusted from a stored `verified` flag.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const session = await getSession();
    const id = url.searchParams.get("id");

    if (id) {
      const originId = requireString(id, "id", { max: 64 });
      const replay = await replayOrigin(session.sessionId, originId);
      if (!replay) return notFoundResponse();

      return Response.json(
        {
          scope: "origin",
          ...replay,
          events: replay.events.map((event) => ({
            seq: event.seq,
            originId: event.originId,
            eventType: event.eventType,
            seal: event.seal,
            prevSeal: event.prevSeal,
            createdAt: event.createdAt,
          })),
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const page = await listOrigins({
      sessionId: session.sessionId,
      includeReference: true,
      query: optionalQuery(url.searchParams.get("q")),
      limit: 100,
      offset: 0,
      sort: "recent",
    });

    const results = [];
    let eventsChecked = 0;
    let broken = 0;

    for (const origin of page.items) {
      const replay = await replayOrigin(session.sessionId, origin.id);
      if (!replay) continue;
      eventsChecked += replay.checked;
      if (!replay.ok) broken += 1;
      results.push({
        originId: origin.id,
        name: origin.name,
        mint: origin.mint,
        ok: replay.ok,
        checked: replay.checked,
        headSeal: replay.headSeal,
        brokenAtSeq: replay.brokenAtSeq,
        brokenReason: replay.brokenReason,
      });
    }

    return Response.json(
      {
        scope: "all",
        origins: results.length,
        eventsChecked,
        broken,
        ok: broken === 0,
        genesis: results.length > 0 ? undefined : "no claims visible",
        results,
        verifiedAt: new Date().toISOString(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return handleError(error);
  }
}