import { getSession, sessionCookieHeader } from "@/lib/session";
import { getSql } from "@/lib/db/sql";
import { ensureSchema } from "@/lib/db/schema";
import { assayMint } from "@/lib/service/assay-service";
import { loadCorpus } from "@/lib/db/repository";
import { handleError, requireMint } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * Stateless assay.
 *
 * Computes the engine result for a mint without persisting anything, so the
 * assay lab can explore candidates freely. Persistence happens through
 * `/api/origins`, which calls the same service.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const mint = requireMint(body.mint);

    const session = await getSession();
    const sql = await getSql();
    await ensureSchema(sql);

    const outcome = await assayMint({
      sessionId: session.sessionId,
      mint,
      includeReference: body.include_reference_registry === undefined ? true : Boolean(body.include_reference_registry),
    });

    /**
     * The corpus travels with the response so the browser can run the
     * open-weight model locally against exactly the same comparison set the
     * server used. Without this the on-device score would not be comparable
     * with the server one.
     */
    const corpus = await loadCorpus(session.sessionId);

    const headers = new Headers({ "cache-control": "no-store" });
    if (session.isNew) headers.append("set-cookie", sessionCookieHeader(session.value));

    return Response.json(
      {
        mint,
        identity: {
          name: outcome.facts.metadata?.name ?? outcome.facts.pairs[0]?.baseToken.name ?? null,
          symbol: outcome.facts.metadata?.symbol ?? outcome.facts.pairs[0]?.baseToken.symbol ?? null,
          description: outcome.facts.metadata?.description ?? null,
          metadataPresent: outcome.facts.metadata !== null,
        },
        facts: outcome.facts,
        similarity: outcome.similarity,
        existingClaims: outcome.existingClaims,
        corpus,
        result: outcome.result,
      },
      { headers },
    );
  } catch (error) {
    return handleError(error);
  }
}