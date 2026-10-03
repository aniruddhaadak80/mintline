import { getSession } from "@/lib/session";
import { getOrigin, saveAssay } from "@/lib/db/repository";
import { assayMint, methodLabel } from "@/lib/service/assay-service";
import { handleError, notFoundResponse, requireObject, requireString } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Re-run the engine for a stored claim and persist the result.
 *
 * Same `assayMint` call the stateless `/api/assay` route uses, so a re-assayed
 * record and a previewed mint are scored identically. The returned
 * `chainHead` is the seal the caller can immediately replay.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const originId = requireString(id, "id", { max: 64 });
    const session = await getSession();

    const existing = await getOrigin(session.sessionId, originId);
    if (!existing) return notFoundResponse();
    if (existing.deletedAt) {
      return Response.json(
        { error: { code: "conflict", message: "This claim is retired and cannot be re-assayed." } },
        { status: 409 },
      );
    }

    const body = requireObject(await request.json().catch(() => ({})));

    const outcome = await assayMint({
      sessionId: session.sessionId,
      mint: existing.mint,
      includeReference: body.include_reference_registry === undefined ? true : Boolean(body.include_reference_registry),
    });

    const updated = await saveAssay(session.sessionId, originId, outcome.result);

    return Response.json(
      {
        origin: updated,
        result: outcome.result,
        comparator: methodLabel(outcome.similarity.method),
        comparatorModel: outcome.similarity.model,
        verificationRef: updated.chainHead,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return handleError(error);
  }
}