import { checkStore } from "@/lib/db/repository";
import { assertProductionStore, isServerlessRuntime } from "@/lib/db/sql";
import { RPC_DEPENDENCY_METHODS } from "@/lib/solana/live";
import { ENGINE_VERSION } from "@/lib/types";
import { handleError } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * Liveness and store proof.
 *
 * This does not return a static "ok". It runs a real round trip against the
 * adapter this deployment resolved to, applies the schema, and fails loudly if
 * a production runtime somehow selected embedded storage.
 */
export async function GET() {
  try {
    const store = await checkStore();
    const productionGuard = assertProductionStore();
    const deployed = isServerlessRuntime();

    const healthy = store.ok && productionGuard.ok;

    return Response.json(
      {
        status: healthy ? "ok" : "degraded",
        engine: ENGINE_VERSION,
        store: {
          adapter: store.adapter,
          reachable: store.ok,
          roundTripMs: store.roundTripMs,
          ...(store.error ? { error: store.error } : {}),
          productionGuard: productionGuard.ok ? "pass" : "fail",
          ...(productionGuard.reason ? { productionGuardReason: productionGuard.reason } : {}),
          schemaApplied: store.ok,
        },
        runtime: {
          serverless: deployed,
          rpcMethods: RPC_DEPENDENCY_METHODS,
        },
        checkedAt: new Date().toISOString(),
      },
      {
        status: healthy ? 200 : 503,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return handleError(error);
  }
}