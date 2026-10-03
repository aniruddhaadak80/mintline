"use client";

import { useCallback, useEffect, useState } from "react";
import { TOOLS } from "@/lib/mcp/server";
import { SAMPLE_MINTS } from "@/lib/solana/fallback";
import { SITE } from "@/lib/config";

interface ConsoleEntry {
  id: number;
  method: string;
  request: unknown;
  response: unknown;
  ok: boolean;
  ms: number;
}

let sequence = 0;

async function rpc(method: string, params?: unknown): Promise<unknown> {
  const response = await fetch("/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method, ...(params ? { params } : {}) }),
  });
  return response.json();
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * The agent console.
 *
 * Every button issues a real JSON-RPC request to `/api/mcp` and prints the real
 * response, including JSON-RPC error objects. The mutation presets return an
 * origin id, and that id is threaded into the later presets, so the sequence
 * read → mutate → read → verify is reproducible by clicking.
 */
export function AgentConsole() {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [originId, setOriginId] = useState<string | null>(null);
  const [mint, setMint] = useState(SAMPLE_MINTS[1]?.mint ?? "");
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const call = useCallback(async (label: string, method: string, params?: unknown) => {
    setBusy(true);
    const started = performance.now();
    try {
      const payload = await rpc(method, params);
      const ok = Boolean((payload as { result?: unknown })?.result) && !(payload as { error?: unknown })?.error;
      setEntries((previous) => [
        {
          id: ++sequence,
          method: label,
          request: { jsonrpc: "2.0", method, ...(params ? { params } : {}) },
          response: payload,
          ok,
          ms: Math.round(performance.now() - started),
        },
        ...previous,
      ]);
      return payload;
    } catch (error) {
      setEntries((previous) => [
        {
          id: ++sequence,
          method: label,
          request: { method },
          response: { transportError: error instanceof Error ? error.message : String(error) },
          ok: false,
          ms: Math.round(performance.now() - started),
        },
        ...previous,
      ]);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const registerOrigin = async () => {
    const payload = (await call("register_origin (mutating)", "tools/call", {
      name: "register_origin",
      arguments: {
        mint,
        name: `Agent specimen ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`,
        idempotency_key: `agent-${mint}-${Date.now()}`,
      },
    })) as {
      result?: { structuredContent?: { origin?: { id: string } } };
    } | null;

    const created = payload?.result?.structuredContent?.origin?.id;
    if (created) setOriginId(created);
  };

  useEffect(() => {
    void call("initialize", "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mintline-console", version: "1.0.0" },
    });
    void call("tools/list", "tools/list");
  }, [call]);

  const presets: Array<{
    label: string;
    hint: string;
    readOnly: boolean;
    needsOrigin?: boolean;
    run: () => Promise<unknown>;
  }> = [
    {
      label: "initialize",
      hint: "protocol handshake",
      readOnly: true,
      run: () => call("initialize", "initialize", { protocolVersion: "2025-06-18", capabilities: {} }),
    },
    {
      label: "tools/list",
      hint: `${TOOLS.length} typed tools`,
      readOnly: true,
      run: () => call("tools/list", "tools/list"),
    },
    {
      label: "assay_mint",
      hint: "analysis tool, live chain read",
      readOnly: true,
      run: () => call("assay_mint", "tools/call", { name: "assay_mint", arguments: { mint } }),
    },
    {
      label: "get_live_market",
      hint: "read tool, normalised facts",
      readOnly: true,
      run: () => call("get_live_market", "tools/call", { name: "get_live_market", arguments: { mint } }),
    },
    {
      label: "list_origins",
      hint: "read tool, scoped to this session",
      readOnly: true,
      run: () => call("list_origins", "tools/call", { name: "list_origins", arguments: { limit: 5 } }),
    },
    {
      label: "register_origin",
      hint: "MUTATING — writes through the UI service layer",
      readOnly: false,
      run: registerOrigin,
    },
    {
      label: "record_verdict",
      hint: "MUTATING — needs an id from register_origin",
      readOnly: false,
      needsOrigin: true,
      run: () =>
        call("record_verdict", "tools/call", {
          name: "record_verdict",
          arguments: { origin_id: originId, status: "disputed", note: "Recorded from the agent console." },
        }),
    },
    {
      label: "share_origin",
      hint: "MUTATING — issues a public dossier link",
      readOnly: false,
      needsOrigin: true,
      run: async () => {
        const payload = (await call("share_origin", "tools/call", {
          name: "share_origin",
          arguments: { origin_id: originId },
        })) as { result?: { structuredContent?: { sharePath?: string } } } | null;
        const path = payload?.result?.structuredContent?.sharePath;
        if (path) setShareUrl(`${window.location.origin}${path}`);
        return payload;
      },
    },
    {
      label: "export_dossier",
      hint: "read tool, markdown dossier",
      readOnly: true,
      needsOrigin: true,
      run: () =>
        call("export_dossier", "tools/call", {
          name: "export_dossier",
          arguments: { origin_id: originId, format: "markdown" },
        }),
    },
    {
      label: "verify_integrity",
      hint: "read tool, replays the seal chain",
      readOnly: true,
      needsOrigin: true,
      run: () =>
        call("verify_integrity", "tools/call", { name: "verify_integrity", arguments: { origin_id: originId } }),
    },
    {
      label: "retire_origin",
      hint: "DESTRUCTIVE — tombstones the record",
      readOnly: false,
      needsOrigin: true,
      run: () => call("retire_origin", "tools/call", { name: "retire_origin", arguments: { origin_id: originId } }),
    },
  ];

  return (
    <div className="space-y-6">
      <section className="specimen p-4">
        <label htmlFor="agent-mint" className="marginalia">
          target mint
        </label>
        <input
          id="agent-mint"
          value={mint}
          onChange={(event) => setMint(event.target.value)}
          spellCheck={false}
          className="mt-1 w-full border border-brass/30 bg-surface-sunken px-3 py-2 font-mono text-sm text-bone focus:border-brass focus:outline-none"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {SAMPLE_MINTS.map((sample) => (
            <button
              key={sample.mint}
              type="button"
              onClick={() => setMint(sample.mint)}
              className="border border-brass/25 px-2 py-1 font-mono text-[0.7rem] text-bone-dim hover:border-brass hover:text-brass"
            >
              {sample.symbol}
            </button>
          ))}
        </div>

        {originId ? (
          <p className="mt-3 border border-brass/30 px-3 py-2 font-mono text-[0.72rem] text-bone-dim">
            active origin: <span className="text-brass">{originId}</span>
          </p>
        ) : null}

        {shareUrl ? (
          <p className="mt-2 border border-verdigris/40 px-3 py-2 font-mono text-[0.72rem] text-verdigris">
            <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
              {shareUrl}
            </a>
          </p>
        ) : null}
      </section>

      <section aria-label="Tool presets">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {presets.map((preset) => {
            const blocked = preset.needsOrigin && !originId;
            return (
              <button
                key={preset.label}
                type="button"
                data-testid={`tool-${preset.label}`}
                onClick={() => void preset.run()}
                disabled={busy || blocked}
                title={preset.hint}
                className={`border px-3 py-2.5 text-left font-mono text-xs transition-colors disabled:opacity-40 ${
                  preset.readOnly
                    ? "border-verdigris/40 text-verdigris hover:bg-verdigris/10"
                    : "border-brass/50 text-brass hover:bg-brass/10"
                }`}
              >
                <span className="block uppercase tracking-[0.1em]">{preset.label}</span>
                <span className="mt-1 block text-[0.65rem] normal-case tracking-normal text-bone-faint">
                  {preset.hint}
                </span>
                {blocked ? (
                  <span className="mt-1 block text-[0.65rem] normal-case text-oxide-bright">
                    needs an origin id — run register_origin first
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      <section aria-label="Call log">
        <div className="flex items-baseline justify-between border-b border-brass/25 pb-2">
          <h2 className="marginalia">call log</h2>
          <button
            type="button"
            onClick={() => setEntries([])}
            className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-bone-dim underline underline-offset-4 hover:text-brass"
          >
            clear
          </button>
        </div>

        {entries.length === 0 ? (
          <p className="mt-4 font-mono text-xs text-bone-faint">
            No calls yet. The handshake runs automatically on load.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {entries.map((entry) => (
              <li key={entry.id} className="specimen p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span
                    className={`font-mono text-xs uppercase tracking-[0.12em] ${
                      entry.ok ? "text-verdigris" : "text-oxide-bright"
                    }`}
                  >
                    {entry.ok ? "200" : "error"} · {entry.method}
                  </span>
                  <span className="font-mono text-[0.65rem] text-bone-faint">{entry.ms}ms</span>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer font-mono text-[0.7rem] uppercase tracking-[0.1em] text-bone-dim">
                    request
                  </summary>
                  <pre className="well mt-2 max-h-48 overflow-auto p-3">{pretty(entry.request)}</pre>
                </details>
                <details open className="mt-2">
                  <summary className="cursor-pointer font-mono text-[0.7rem] uppercase tracking-[0.1em] text-bone-dim">
                    response
                  </summary>
                  <pre className="well mt-2 max-h-72 overflow-auto p-3" data-testid="agent-response">
                    {pretty(entry.response)}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="font-mono text-[0.7rem] leading-relaxed text-bone-faint">
Point any MCP client at{" "}
        <code className="text-brass">{`${SITE.liveUrl}/api/mcp`}</code>{" "}
        — the published manifest is at{" "}
        <a href="/mcp.json" className="text-brass underline underline-offset-4">`n          /mcp.json`n        </a>
        .
      </p>
    </div>
  );
}