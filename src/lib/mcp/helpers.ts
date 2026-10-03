/**
 * Thin MCP helpers.
 *
 * Exists only so `server.ts` can read a chain and stay testable in isolation:
 * the session-scoped read lives here rather than widening `server.ts`'s import
 * surface.
 */

import { getChainEvents } from "../db/repository";

export async function getChainEventsForTool(sessionId: string, originId: string) {
  return getChainEvents(sessionId, originId);
}