import { beforeEach, describe, expect, it } from "vitest";

/**
 * MCP JSON-RPC 2.0 contract.
 *
 * Covers the envelope rules an MCP client depends on: a tool failure must be a
 * JSON-RPC success carrying `isError`, not a JSON-RPC error, and an unknown
 * method must be a proper `-32601`.
 */

process.env.MINTLINE_PGLITE_DIR = ":memory:";
delete process.env.DATABASE_URL;

const { handleJsonRpc, callTool, TOOLS, PROTOCOL_VERSION } = await import("@/lib/mcp/server");
const { getSql } = await import("@/lib/db/sql");
const { ensureSchema } = await import("@/lib/db/schema");
const { resetSeedCache } = await import("@/lib/db/repository");

const SESSION = "s_mcptest0000000000000000a";
const MINT = "So11111111111111111111111111111111111111112";

beforeEach(async () => {
  const sql = await getSql();
  await ensureSchema(sql);
  resetSeedCache();
  await sql.query("DELETE FROM chain_events");
  await sql.query("DELETE FROM origins");
});

function rpc(method: string, params?: unknown) {
  return handleJsonRpc({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }, { sessionId: SESSION });
}

describe("JSON-RPC envelope", () => {
  it("rejects a request that is not an object", async () => {
    const response = await handleJsonRpc("nope", { sessionId: SESSION });
    expect(response.error?.code).toBe(-32600);
  });

  it("rejects a missing jsonrpc version", async () => {
    const response = await handleJsonRpc({ id: 1, method: "initialize" }, { sessionId: SESSION });
    expect(response.error?.code).toBe(-32600);
  });

  it("rejects an unknown method with -32601", async () => {
    const response = await rpc("does/not/exist");
    expect(response.error?.code).toBe(-32601);
    expect(response.error?.message).toMatch(/Unknown method/);
  });

  it("rejects a batch explicitly rather than half-processing it", async () => {
    const response = await handleJsonRpc([{ jsonrpc: "2.0", id: 1, method: "ping" }], {
      sessionId: SESSION,
    });
    expect(response.error?.code).toBe(-32600);
  });

  it("echoes the request id, including null", async () => {
    const withId = await rpc("ping");
    expect(withId.id).toBe(1);

    const withoutId = await handleJsonRpc({ jsonrpc: "2.0", method: "ping" }, { sessionId: SESSION });
    expect(withoutId.id).toBeNull();
  });
});

describe("initialize and tools/list", () => {
  it("advertises the protocol version and tool capability", async () => {
    const response = await rpc("initialize");
    const result = response.result as {
      protocolVersion: string;
      serverInfo: { name: string; version: string };
      capabilities: { tools: unknown };
      instructions: string;
    };
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(result.serverInfo.name).toBe("mintline");
    expect(result.capabilities.tools).toBeDefined();
    expect(result.instructions).toMatch(/assay_mint/);
  });

  it("lists every tool with an input schema", async () => {
    const response = await rpc("tools/list");
    const result = response.result as { tools: typeof TOOLS };
    expect(result.tools.length).toBe(TOOLS.length);
    expect(result.tools.length).toBeGreaterThanOrEqual(3);

    for (const tool of result.tools) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe("object");
      expect(typeof tool.inputSchema.properties).toBe("object");
      expect(typeof tool.annotations.readOnlyHint).toBe("boolean");
    }
  });

  it("exposes at least one read, one analysis and one mutating tool", async () => {
    const readOnly = TOOLS.filter((tool) => tool.annotations.readOnlyHint).map((t) => t.name);
    const mutating = TOOLS.filter((tool) => !tool.annotations.readOnlyHint).map((t) => t.name);

    expect(readOnly).toContain("assay_mint");
    expect(readOnly).toContain("list_origins");
    expect(readOnly).toContain("verify_integrity");
    expect(mutating).toContain("register_origin");
    expect(mutating).toContain("record_verdict");
    expect(mutating).toContain("retire_origin");
  });

  it("marks exactly the destructive tools", () => {
    const destructive = TOOLS.filter((tool) => tool.annotations.destructiveHint).map((t) => t.name);
    expect(destructive).toEqual(["retire_origin"]);
  });
});

describe("tools/call validation", () => {
  it("returns a JSON-RPC error for an unknown tool name", async () => {
    const response = await rpc("tools/call", { name: "not_a_tool" });
    expect(response.error?.code).toBe(-32602);
    expect((response.error?.data as { available: string[] }).available).toContain("assay_mint");
  });

  it("returns -32602 for a missing required argument", async () => {
    const response = await rpc("tools/call", { name: "assay_mint", arguments: {} });
    expect(response.error?.code).toBe(-32602);
    expect(response.error?.message).toMatch(/mint/);
  });

  it("rejects a non-object arguments payload", async () => {
    const response = await rpc("tools/call", { name: "assay_mint", arguments: "nope" });
    expect(response.error?.code).toBe(-32602);
  });

  it("reports a tool-level miss as isError, not a JSON-RPC error", async () => {
    const response = await rpc("tools/call", {
      name: "get_origin",
      arguments: { origin_id: "o_does_not_exist" },
    });
    expect(response.error).toBeUndefined();
    const result = response.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/No origin/);
  });

  it("rejects a mint containing non-base58 characters before touching the network", async () => {
    // Correct length, illegal alphabet: Solana addresses never contain 0.
    const response = await rpc("tools/call", { name: "assay_mint", arguments: { mint: "0".repeat(44) } });
    expect(response.error?.code).toBe(-32602);
    expect(response.error?.message).toMatch(/base58/);
  });

  it("rejects a mint that is too short", async () => {
    const response = await rpc("tools/call", { name: "assay_mint", arguments: { mint: "nope" } });
    expect(response.error?.code).toBe(-32602);
    expect(response.error?.message).toMatch(/at least 32/);
  });
});

describe("mutating tools write through the shared service layer", () => {
  it("registers, reads back, records a verdict and verifies — all over RPC", async () => {
    // 1. Mutating create.
    const created = await rpc("tools/call", {
      name: "register_origin",
      arguments: {
        mint: MINT,
        name: "MCP Fixture Origin",
        idempotency_key: "mcp-test-1",
      },
    });
    expect(created.error).toBeUndefined();
    const createdResult = created.result as {
      structuredContent: { created: boolean; origin: { id: string }; chainHead: string };
    };
    expect(createdResult.structuredContent.created).toBe(true);
    const originId = createdResult.structuredContent.origin.id;
    expect(createdResult.structuredContent.chainHead).toMatch(/^[0-9a-f]{96}$/);

    // 2. Read-back through a read tool proves the write actually persisted.
    const read = await rpc("tools/call", { name: "get_origin", arguments: { origin_id: originId } });
    const readResult = read.result as { structuredContent: { id: string; name: string } };
    expect(readResult.structuredContent.id).toBe(originId);
    expect(readResult.structuredContent.name).toBe("MCP Fixture Origin");

    // 3. The same record is visible through the REST-facing repository too.
    const { getOrigin } = await import("@/lib/db/repository");
    const viaRepository = await getOrigin(SESSION, originId);
    expect(viaRepository).not.toBeNull();

    // 4. Mutating verdict.
    const verdict = await rpc("tools/call", {
      name: "record_verdict",
      arguments: { origin_id: originId, status: "disputed", note: "via agent" },
    });
    const verdictResult = verdict.result as {
      structuredContent: { origin: { status: string }; eventCount: number };
    };
    expect(verdictResult.structuredContent.origin.status).toBe("disputed");
    expect(verdictResult.structuredContent.eventCount).toBe(2);

    // 5. Integrity replay passes.
    const verify = await rpc("tools/call", {
      name: "verify_integrity",
      arguments: { origin_id: originId },
    });
    const verifyResult = verify.result as { structuredContent: { ok: boolean; checked: number } };
    expect(verifyResult.structuredContent.ok).toBe(true);
    expect(verifyResult.structuredContent.checked).toBe(2);

    // 6. Mutating retirement leaves a replayable tombstone.
    const retired = await rpc("tools/call", {
      name: "retire_origin",
      arguments: { origin_id: originId },
    });
    const retiredResult = retired.result as {
      structuredContent: { origin: { deletedAt: string | null }; tombstone: boolean };
    };
    expect(retiredResult.structuredContent.tombstone).toBe(true);
    expect(retiredResult.structuredContent.origin.deletedAt).not.toBeNull();

    const afterRetire = await rpc("tools/call", {
      name: "verify_integrity",
      arguments: { origin_id: originId },
    });
    const afterResult = afterRetire.result as { structuredContent: { ok: boolean; checked: number } };
    expect(afterResult.structuredContent.ok).toBe(true);
    expect(afterResult.structuredContent.checked).toBe(3);
  });

  it("is idempotent across a retried create", async () => {
    const args = {
      name: "register_origin",
      arguments: { mint: MINT, name: "Retry Fixture", idempotency_key: "mcp-retry" },
    };

    const first = await rpc("tools/call", args);
    const second = await rpc("tools/call", args);

    const a = first.result as { structuredContent: { created: boolean; origin: { id: string } } };
    const b = second.result as { structuredContent: { created: boolean; origin: { id: string } } };

    expect(a.structuredContent.created).toBe(true);
    expect(b.structuredContent.created).toBe(false);
    expect(b.structuredContent.origin.id).toBe(a.structuredContent.origin.id);
  });

  it("scopes reads to the calling session", async () => {
    const created = await callTool(
      "register_origin",
      { mint: MINT, name: "Scoped Fixture", idempotency_key: "scope-1" },
      { sessionId: SESSION },
    );
    const originId = (
      created.structuredContent as { origin: { id: string } }
    ).origin.id;

    // A different session must not see it.
    const other = await callTool("get_origin", { origin_id: originId }, { sessionId: "s_other000000000000000000b" });
    expect(other.isError).toBe(true);
  });

  it("exports a dossier containing the seal chain", async () => {
    const created = await callTool(
      "register_origin",
      { mint: MINT, name: "Dossier Fixture", idempotency_key: "dossier-1" },
      { sessionId: SESSION },
    );
    const originId = (created.structuredContent as { origin: { id: string } }).origin.id;

    const exported = await callTool(
      "export_dossier",
      { origin_id: originId, format: "markdown" },
      { sessionId: SESSION },
    );
    const text = exported.content[0].text;
    expect(text).toMatch(/# Origin dossier/);
    expect(text).toMatch(/## Integrity chain/);
    expect(text).toMatch(/seal\(n\) = SHA-384/);
    expect(text).toMatch(/## Disclaimer/);
  });
});