/**
 * MCP-style JSON-RPC 2.0 endpoint.
 *
 * Implements `initialize`, `tools/list` and `tools/call` over HTTP POST.
 *
 * The mutating tools do not write to the database themselves: they call the same
 * repository functions the UI forms call, so "an agent can mutate through the
 * same path as the UI" is a property of the code, not a claim about it.
 *
 * Every tool is scoped to the caller's anonymous session, exactly like the REST
 * routes. An agent gets its own scope from the same signed cookie, so it cannot
 * reach records created in a different browser session.
 *
 * Idempotency: mutating tools accept an `idempotency_key`. Passing the same key
 * twice returns the first result rather than creating a duplicate, which is what
 * makes a retrying agent safe.
 */

import { assayMint, methodLabel } from "../service/assay-service";
import {
  ConflictError,
  getOrigin,
  listOrigins,
  loadCorpus,
  newShareToken,
  recordVerdict,
  registerOrigin,
  retireOrigin,
  replayOrigin,
  setShareToken,
  type ListOptions,
} from "../db/repository";
import { buildDossier, dossierToMarkdown } from "../export/dossier";
import { loadMintFacts } from "../solana/live";
import { getChainEventsForTool } from "./helpers";
import { ENGINE_VERSION } from "../types";
import {
  LIMITS,
  optionalQuery,
  optionalString,
  requireMint,
  requireObject,
  requireStatus,
  requireString,
  ValidationError,
} from "../validation";
import type { JsonRpcError, JsonRpcRequest, JsonRpcResponse, McpTool } from "../types";

export const PROTOCOL_VERSION = "2025-06-18";

const JSON_RPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

/* ------------------------------------------------------------------ *
 * Tool definitions
 * ------------------------------------------------------------------ */

export const TOOLS: McpTool[] = [
  {
    name: "assay_mint",
    title: "Assay a Solana mint",
    description:
      "Decode on-chain metadata for a Solana mint, compare its identity text against the origin registry, and return a versioned, explainable provenance score with itemized factors. Reads live chain data; performs no write.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        mint: {
          type: "string",
          description: "Base58 Solana mint address.",
          minLength: LIMITS.mintLengthMin,
          maxLength: LIMITS.mintLengthMax,
        },
        include_reference_registry: {
          type: "boolean",
          description: "Include the shared reference origins in the collision corpus. Default true.",
          default: true,
        },
      },
      required: ["mint"],
      additionalProperties: false,
    },
  },
  {
    name: "get_live_market",
    title: "Read live market and metadata facts",
    description:
      "Return normalized live facts for a mint: decoded Metaplex metadata, trading pairs, liquidity, volume, age, holder concentration, and per-source attribution with fetch timestamps.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        mint: { type: "string", description: "Base58 Solana mint address." },
      },
      required: ["mint"],
      additionalProperties: false,
    },
  },
  {
    name: "list_origins",
    title: "List origin claims",
    description:
      "List origin claims visible to this session, including the shared reference registry. Supports paging, status filter, text search and sorting by score.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: LIMITS.limitMax, default: 25 },
        offset: { type: "integer", minimum: 0, default: 0 },
        status: { type: "string", enum: ["all", "registered", "disputed", "retired"] },
        query: { type: "string", maxLength: LIMITS.queryMax },
        sort: { type: "string", enum: ["recent", "score", "name"], default: "recent" },
        include_reference_registry: { type: "boolean", default: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_origin",
    title: "Read one origin claim",
    description: "Return a single origin claim with its stored assay, plus the full audit chain when requested.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        origin_id: { type: "string", description: "Origin identifier." },
        include_chain: { type: "boolean", default: false },
      },
      required: ["origin_id"],
      additionalProperties: false,
    },
  },
  {
    name: "verify_integrity",
    title: "Replay an origin's audit chain",
    description:
      "Recompute every seal in an origin's chain and report the first broken link. Returns the genesis, the head seal and the number of events verified.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        origin_id: { type: "string", description: "Origin identifier." },
      },
      required: ["origin_id"],
      additionalProperties: false,
    },
  },
  {
    name: "register_origin",
    title: "Register an origin claim",
    description:
      "Create a new origin claim in the caller's session after running the assay against the live chain. Writes through the same service layer as the UI and appends a sealed audit event. Idempotent when an idempotency_key is supplied.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        mint: { type: "string", description: "Base58 Solana mint address." },
        name: { type: "string", maxLength: LIMITS.nameMax, description: "Registered origin name." },
        symbol: { type: "string", maxLength: LIMITS.symbolMax },
        description: { type: "string", maxLength: LIMITS.descriptionMax },
        claim_note: { type: "string", maxLength: LIMITS.noteMax },
        idempotency_key: {
          type: "string",
          maxLength: 120,
          description: "Repeat a key to make a retried create safe.",
        },
        match_symbol: { type: "boolean", default: true },
      },
      required: ["mint", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "record_verdict",
    title: "Record a verdict on a claim",
    description:
      "Set an origin claim to registered, disputed or retired, optionally attaching a note. Writes an audit event and returns the new chain head.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        origin_id: { type: "string" },
        status: { type: "string", enum: ["registered", "disputed", "retired"] },
        note: { type: "string", maxLength: LIMITS.noteMax },
        idempotency_key: { type: "string", maxLength: 120 },
      },
      required: ["origin_id", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "retire_origin",
    title: "Retire an origin claim",
    description:
      "Soft-delete an origin claim. The row is retained as a tombstone so the audit chain can still be replayed. Reference registry entries cannot be retired.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: {
        origin_id: { type: "string" },
        reason: { type: "string", maxLength: LIMITS.noteMax },
      },
      required: ["origin_id"],
      additionalProperties: false,
    },
  },
  {
    name: "share_origin",
    title: "Create or revoke a share link",
    description:
      "Issue or revoke an unguessable share token for an origin claim, producing a stable public read-only dossier URL.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        origin_id: { type: "string" },
        revoke: { type: "boolean", default: false },
      },
      required: ["origin_id"],
      additionalProperties: false,
    },
  },
  {
    name: "export_dossier",
    title: "Export an origin dossier",
    description:
      "Produce the downloadable origin dossier for a claim as Markdown or JSON, including factors, source attribution and the seal chain.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        origin_id: { type: "string" },
        format: { type: "string", enum: ["markdown", "json"], default: "markdown" },
      },
      required: ["origin_id"],
      additionalProperties: false,
    },
  },
];

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

interface ToolContext {
  sessionId: string;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

function text(value: unknown): ToolResult {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
    structuredContent: typeof value === "string" ? { text: value } : value,
  };
}

function toolError(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export async function callTool(
  name: string,
  rawArgs: unknown,
  context: ToolContext,
): Promise<ToolResult> {
  const args = rawArgs === undefined || rawArgs === null ? {} : requireObject(rawArgs, "arguments");

  switch (name) {
    case "assay_mint": {
      const mint = requireMint(args.mint);
      const includeReference =
        args.include_reference_registry === undefined ? true : Boolean(args.include_reference_registry);
      const outcome = await assayMint({ sessionId: context.sessionId, mint, includeReference });
      return text({
        engineVersion: outcome.result.engineVersion,
        score: outcome.result.score,
        verdict: outcome.result.verdict,
        degraded: outcome.result.degraded,
        comparator: methodLabel(outcome.similarity.method),
        comparatorModel: outcome.similarity.model,
        factors: outcome.result.factors,
        neighbors: outcome.result.neighbors,
        recommendation: outcome.result.recommendation,
        identity: {
          name: outcome.facts.metadata?.name ?? null,
          symbol: outcome.facts.metadata?.symbol ?? null,
          descriptionLength: outcome.facts.metadata?.description?.length ?? 0,
        },
        sources: outcome.facts.sources,
      });
    }

    case "get_live_market": {
      const mint = requireMint(args.mint);
      const facts = await loadMintFacts(mint, { allowFallback: true });
      return text(facts);
    }

    case "list_origins": {
      const options: ListOptions = {
        sessionId: context.sessionId,
        includeReference: args.include_reference_registry === undefined ? true : Boolean(args.include_reference_registry),
        limit: typeof args.limit === "number" ? Math.min(LIMITS.limitMax, Math.max(1, args.limit)) : 25,
        offset: typeof args.offset === "number" ? Math.max(0, args.offset) : 0,
        status: (args.status as ListOptions["status"]) ?? "all",
        query: optionalQuery(args.query),
        sort: (args.sort as ListOptions["sort"]) ?? "recent",
      };
      const page = await listOrigins(options);
      return text(page);
    }

    case "get_origin": {
      const originId = requireString(args.origin_id, "origin_id", { max: 64 });
      const origin = await getOrigin(context.sessionId, originId);
      if (!origin) return toolError(`No origin ${originId} is visible to this session.`);
      const includeChain = Boolean(args.include_chain);
      return text({
        ...origin,
        ...(includeChain ? { chain: await getChainEventsForTool(context.sessionId, originId) } : {}),
      });
    }

    case "verify_integrity": {
      const originId = requireString(args.origin_id, "origin_id", { max: 64 });
      const replay = await replayOrigin(context.sessionId, originId);
      if (!replay) return toolError(`No origin ${originId} is visible to this session.`);
      return text({
        originId: replay.originId,
        ok: replay.ok,
        checked: replay.checked,
        genesis: replay.genesis,
        headSeal: replay.headSeal,
        brokenAtSeq: replay.brokenAtSeq,
        brokenReason: replay.brokenReason,
        events: replay.events.map((event) => ({
          seq: event.seq,
          eventType: event.eventType,
          seal: event.seal,
          createdAt: event.createdAt,
        })),
      });
    }

    case "register_origin": {
      const mint = requireMint(args.mint);
      const name = requireString(args.name, "name", { max: LIMITS.nameMax });
      const outcome = await assayMint({ sessionId: context.sessionId, mint });
      const registered = await registerOrigin({
        sessionId: context.sessionId,
        mint,
        name,
        symbol: outcome.facts.metadata?.symbol ?? (typeof args.symbol === "string" ? args.symbol : null),
        description:
          outcome.facts.metadata?.description ??
          optionalString(args.description, "description", { max: LIMITS.descriptionMax }),
        claimNote: optionalString(args.claim_note, "claim_note", { max: LIMITS.noteMax }),
        assay: outcome.result,
        idempotencyKey: optionalString(args.idempotency_key, "idempotency_key", { max: 120 }),
      });
      const events = await getChainEventsForTool(context.sessionId, registered.origin.id);
      return text({
        created: registered.created,
        origin: registered.origin,
        score: outcome.result.score,
        verdict: outcome.result.verdict,
        chainHead: events[events.length - 1]?.seal ?? registered.origin.chainHead,
      });
    }

    case "record_verdict": {
      const originId = requireString(args.origin_id, "origin_id", { max: 64 });
      const status = requireStatus(args.status);
      const updated = await recordVerdict(
        context.sessionId,
        originId,
        status,
        optionalString(args.note, "note", { max: LIMITS.noteMax }),
        optionalString(args.idempotency_key, "idempotency_key", { max: 120 }),
      );
      return text({ origin: updated, chainHead: updated.chainHead, eventCount: updated.eventCount });
    }

    case "retire_origin": {
      const originId = requireString(args.origin_id, "origin_id", { max: 64 });
      const retired = await retireOrigin(context.sessionId, originId);
      return text({
        origin: retired,
        chainHead: retired.chainHead,
        tombstone: true,
        note: "The row is retained so the audit chain can still be replayed.",
      });
    }

    case "share_origin": {
      const originId = requireString(args.origin_id, "origin_id", { max: 64 });
      const revoke = Boolean(args.revoke);
      const token = revoke ? null : newShareToken();
      const updated = await setShareToken(context.sessionId, originId, token);
      return text({
        originId: updated.id,
        shareToken: updated.shareToken,
        sharePath: updated.shareToken ? `/share/${updated.shareToken}` : null,
      });
    }

    case "export_dossier": {
      const originId = requireString(args.origin_id, "origin_id", { max: 64 });
      const origin = await getOrigin(context.sessionId, originId);
      if (!origin) return toolError(`No origin ${originId} is visible to this session.`);
      const events = await getChainEventsForTool(context.sessionId, originId);
      const facts = await loadMintFacts(origin.mint, { allowFallback: true });
      const dossier = buildDossier(origin, facts, events);
      const format = args.format === "json" ? "json" : "markdown";
      return text(format === "json" ? dossier : dossierToMarkdown(dossier));
    }

    default:
      return toolError(`Unknown tool "${name}".`);
  }
}

/* ------------------------------------------------------------------ *
 * JSON-RPC envelope
 * ------------------------------------------------------------------ */

export function serverInfo() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    serverInfo: { name: "mintline", version: "1.0.0" },
    capabilities: { tools: { listChanged: false } },
    instructions:
      "Mintline assays Solana token identities for name collisions against a public origin registry. " +
      "Start with assay_mint, then register_origin to record a claim, and verify_integrity to replay its seal chain. " +
      `Engine ${ENGINE_VERSION}. Scores measure observable structure and are not financial advice.`,
  };
}

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  const error: JsonRpcError = { code, message, ...(data ? { data } : {}) };
  return { jsonrpc: "2.0", id, error };
}

export async function handleJsonRpc(
  request: unknown,
  context: ToolContext,
): Promise<JsonRpcResponse> {
  if (Array.isArray(request)) {
    return fail(null, JSON_RPC.invalidRequest, "Batch requests are not supported; send one object.");
  }
  if (typeof request !== "object" || request === null) {
    return fail(null, JSON_RPC.invalidRequest, "Request must be a JSON object.");
  }

  const rpc = request as JsonRpcRequest;
  const id = rpc.id === undefined ? null : rpc.id;

  if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
    return fail(id, JSON_RPC.invalidRequest, 'Request must set "jsonrpc":"2.0" and a string "method".');
  }

  try {
    switch (rpc.method) {
      case "initialize":
        return ok(id, serverInfo());

      case "notifications/initialized":
        return ok(id, {});

      case "ping":
        return ok(id, {});

      case "tools/list":
        return ok(id, { tools: TOOLS });

      case "tools/call": {
        const params = requireObject(rpc.params ?? {}, "params");
        const name = requireString(params.name, "name", { max: 64 });
        if (!TOOLS.some((tool) => tool.name === name)) {
          return fail(id, JSON_RPC.invalidParams, `Unknown tool "${name}".`, {
            available: TOOLS.map((tool) => tool.name),
          });
        }
        const result = await callTool(name, params.arguments, context);
        // A tool-level failure is a JSON-RPC success carrying `isError`, which
        // is what the MCP specification prescribes.
        return ok(id, result);
      }

      default:
        return fail(id, JSON_RPC.methodNotFound, `Unknown method "${rpc.method}".`);
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return fail(id, JSON_RPC.invalidParams, error.message, error.details);
    }
    if (error instanceof ConflictError) {
      return fail(id, JSON_RPC.invalidParams, error.message);
    }
    if (error instanceof Error && error.name === "NotFoundError") {
      return fail(id, JSON_RPC.invalidParams, "The requested record does not exist.");
    }
    return fail(id, JSON_RPC.internalError, "The tool call failed.");
  }
}

export { loadCorpus };