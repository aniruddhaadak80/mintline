import type { Metadata } from "next";
import { AgentConsole } from "@/components/AgentConsole";
import { TOOLS, PROTOCOL_VERSION, serverInfo } from "@/lib/mcp/server";

export const metadata: Metadata = {
  title: "Agent console",
  description:
    "A live MCP JSON-RPC 2.0 console. Run initialize, tools/list and mutating tools/call requests against the real endpoint and read the real responses.",
};

export default function AgentPage() {
  const info = serverInfo();
  const readTools = TOOLS.filter((tool) => tool.annotations.readOnlyHint);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="border-b border-brass/25 pb-6">
        <p className="marginalia">rpc 2.0</p>
        <h1 className="mt-2 text-3xl text-bone sm:text-4xl">Agent console</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-bone-dim">
          {TOOLS.length} tools, of which {readTools.length} are read-only and {TOOLS.length - readTools.length}{" "}
          write through the same service layer the UI uses. Every button below is a real request; nothing
          here is simulated.
        </p>
        <p className="mt-3 font-mono text-xs text-bone-faint">
          protocol {PROTOCOL_VERSION} · server {info.serverInfo.name} v{info.serverInfo.version}
        </p>
      </header>

      <div className="mt-8">
        <AgentConsole />
      </div>

      <section className="mt-12">
        <h2 className="marginalia">tool schemas</h2>
        <ul className="mt-4 space-y-2">
          {TOOLS.map((tool) => (
            <li key={tool.name} className="ledger-row py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-sm text-bone">{tool.name}</span>
                <span
                  className={`font-mono text-[0.65rem] uppercase tracking-[0.12em] ${
                    tool.annotations.readOnlyHint ? "text-verdigris" : "text-brass"
                  }`}
                >
                  {tool.annotations.readOnlyHint ? "read-only" : "mutating"}
                  {tool.annotations.destructiveHint ? " · destructive" : ""}
                </span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-bone-dim">{tool.description}</p>
              <p className="mt-1 font-mono text-[0.68rem] text-bone-faint">
                required: {tool.inputSchema.required?.join(", ") || "none"}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}