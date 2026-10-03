import { getSession, sessionCookieHeader } from "@/lib/session";
import { handleJsonRpc } from "@/lib/mcp/server";
import { touchSession } from "@/lib/db/repository";
import { getSql } from "@/lib/db/sql";
import { ensureSchema } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * MCP-style JSON-RPC 2.0 endpoint.
 *
 * POST one request object per call. Session ownership is the same signed cookie
 * the browser uses, so an agent gets its own scope and cannot reach another
 * session's records.
 */
export async function POST(request: Request) {
  const session = await getSession();

  try {
    const sql = await getSql();
    await ensureSchema(sql);
    await touchSession(sql, session.sessionId);
  } catch {
    // Tools that need storage will surface the real failure themselves.
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Request body was not valid JSON." } },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const response = await handleJsonRpc(payload, { sessionId: session.sessionId });

  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  if (session.isNew) headers.append("set-cookie", sessionCookieHeader(session.value));

  return Response.json(response, { status: 200, headers });
}

/** A GET on the endpoint explains itself rather than 405-ing silently. */
export async function GET() {
  return Response.json(
    {
      name: "mintline-mcp",
      transport: "http",
      endpoint: "/api/mcp",
      method: "POST",
      protocolVersion: "2025-06-18",
      methods: ["initialize", "tools/list", "tools/call"],
      hint: "Send a JSON-RPC 2.0 request object to this URL, for example: {\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}",
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}