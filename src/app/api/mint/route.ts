import { getSession, sessionCookieHeader } from "@/lib/session";
import { touchSession } from "@/lib/db/repository";
import { getSql } from "@/lib/db/sql";
import { ensureSchema } from "@/lib/db/schema";
import { loadMintFacts } from "@/lib/solana/live";
import { handleError, requireMint } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * Live facts for one mint.
 *
 * Sends the session cookie on first touch so a client that only reads data still
 * gets a stable ownership scope for anything it creates later.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const mint = requireMint(url.searchParams.get("mint"));

    const session = await getSession();
    if (session.isNew) {
      try {
        const sql = await getSql();
        await ensureSchema(sql);
        await touchSession(sql, session.sessionId);
      } catch {
        // A read must still succeed if the session table is not ready yet.
      }
    }

    const facts = await loadMintFacts(mint, { allowFallback: true });

    const headers = new Headers({ "cache-control": "no-store" });
    if (session.isNew) headers.append("set-cookie", sessionCookieHeader(session.value));

    return Response.json(facts, { headers });
  } catch (error) {
    return handleError(error);
  }
}