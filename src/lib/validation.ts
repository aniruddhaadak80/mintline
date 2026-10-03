/**
 * Input validation and the stable error envelope.
 *
 * Every route and every MCP tool validates through this module, so the failure
 * shape is identical everywhere: `{ error: { code, message, details? } }` with a
 * correct 4xx status. Malformed input never reaches SQL, never reaches the
 * engine, and never produces a stack trace in a response body.
 */

import { ValidationError } from "./db/repository";
import type { ApiError } from "./types";

export { ValidationError };

export const LIMITS = {
  nameMax: 80,
  symbolMax: 24,
  descriptionMax: 4_000,
  noteMax: 600,
  mintLengthMin: 32,
  mintLengthMax: 44,
  queryMax: 64,
  limitMax: 100,
} as const;

const SYMBOL_RE = /^[A-Za-z0-9._-]{1,24}$/;
// C0 controls plus DEL. Written with escapes so the source stays plain ASCII.
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export function requireString(
  value: unknown,
  field: string,
  options: { min?: number; max: number; allowEmpty?: boolean } = { max: 255 },
): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`, { field });
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 && !options.allowEmpty) {
    throw new ValidationError(`${field} is required`, { field });
  }
  const min = options.min ?? 1;
  if (trimmed.length > options.max) {
    throw new ValidationError(`${field} must be at most ${options.max} characters`, { field });
  }
  if (trimmed.length > 0 && trimmed.length < min) {
    throw new ValidationError(`${field} must be at least ${min} characters`, { field });
  }
  if (CONTROL_RE.test(trimmed)) {
    throw new ValidationError(`${field} contains control characters`, { field });
  }
  return trimmed;
}

export function optionalString(value: unknown, field: string, options: { max: number }): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requireString(value, field, { ...options, allowEmpty: false });
}

export function requireMint(value: unknown): string {
  const mint = requireString(value, "mint", {
    min: LIMITS.mintLengthMin,
    max: LIMITS.mintLengthMax,
  });
  // Base58 only: Solana addresses never contain 0, O, I or l.
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    throw new ValidationError("mint must be a base58 Solana address", { field: "mint" });
  }
  return mint;
}

export function optionalSymbol(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const symbol = requireString(value, "symbol", { max: LIMITS.symbolMax });
  if (!SYMBOL_RE.test(symbol)) {
    throw new ValidationError(
      "symbol may only contain letters, digits, dot, underscore and hyphen",
      { field: "symbol" },
    );
  }
  return symbol;
}

const VERDICTS = new Set(["registered", "disputed", "retired"]);

export function requireStatus(value: unknown): "registered" | "disputed" | "retired" {
  if (typeof value !== "string" || !VERDICTS.has(value)) {
    throw new ValidationError("status must be one of registered, disputed, retired", {
      field: "status",
      allowed: [...VERDICTS],
    });
  }
  return value as "registered" | "disputed" | "retired";
}

export function optionalIsoDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const text = requireString(value, field, { max: 40 });
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(`${field} must be an ISO-8601 date`, { field });
  }
  return new Date(parsed).toISOString();
}

export function optionalQuery(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, LIMITS.queryMax);
  return trimmed.length > 0 ? trimmed : undefined;
}

export function boundedInt(
  value: unknown,
  field: string,
  options: { min: number; max: number; fallback: number },
): number {
  if (value === undefined || value === null || value === "") return options.fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(`${field} must be a number`, { field });
  }
  const truncated = Math.trunc(parsed);
  if (truncated < options.min || truncated > options.max) {
    throw new ValidationError(`${field} must be between ${options.min} and ${options.max}`, {
      field,
    });
  }
  return truncated;
}

/** Rejects anything that is not a plain JSON object. */
export function requireObject(value: unknown, field = "body"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(`${field} must be a JSON object`, { field });
  }
  return value as Record<string, unknown>;
}

/** Stable error response. Never leaks internals. */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  const body: ApiError = { error: { code, message, ...(details ? { details } : {}) } };
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** 404 used when a record is absent *or* owned by another session. */
export function notFoundResponse(): Response {
  return errorResponse(404, "not_found", "The requested record does not exist.");
}

/**
 * Map a thrown error onto a status and a safe code.
 *
 * Unknown errors become a generic 500 with no message, because an unexpected
 * exception's text can carry a connection string or a file path.
 */
export function handleError(error: unknown): Response {
  if (error instanceof ValidationError) {
    return errorResponse(400, "invalid_request", error.message, error.details);
  }
  const named = error as { name?: unknown; message?: unknown } | null;
  const name = typeof named?.name === "string" ? named.name : "";
  const message = typeof named?.message === "string" ? named.message : "";

  if (name === "NotFoundError") {
    return errorResponse(404, "not_found", "The requested record does not exist.");
  }
  if (name === "ConflictError") {
    return errorResponse(409, "conflict", message || "The request conflicts with the current state.");
  }
  if (name === "ConfigurationError") {
    return errorResponse(503, "misconfigured", "Storage is not configured for this deployment.");
  }
  return errorResponse(500, "internal_error", "Something went wrong handling that request.");
}