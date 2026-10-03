import { getSession } from "@/lib/session";
import { getOrigin, getChainEvents } from "@/lib/db/repository";
import { loadMintFacts } from "@/lib/solana/live";
import { buildDossier, dossierToMarkdown } from "@/lib/export/dossier";
import { handleError, notFoundResponse, requireString } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * The takeaway artifact.
 *
 * `?format=md` (default) returns `text/markdown`; `?format=json` returns the
 * dossier object. Both send a `Content-Disposition` filename so the response
 * downloads rather than rendering in place.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const originId = requireString(url.searchParams.get("id"), "id", { max: 64 });
    const session = await getSession();

    const origin = await getOrigin(session.sessionId, originId);
    if (!origin) return notFoundResponse();

    const [events, facts] = await Promise.all([
      getChainEvents(session.sessionId, originId),
      loadMintFacts(origin.mint, { allowFallback: true }),
    ]);

    const dossier = buildDossier(origin, facts, events);
    const format = url.searchParams.get("format") === "json" ? "json" : "md";
    const slug =
      origin.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "origin";

    if (format === "json") {
      return new Response(JSON.stringify(dossier, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="mintline-${slug}.json"`,
          "cache-control": "no-store",
        },
      });
    }

    return new Response(dossierToMarkdown(dossier), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="mintline-${slug}.md"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return handleError(error);
  }
}