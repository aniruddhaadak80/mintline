/**
 * Anonymous session ownership.
 *
 * There are no accounts. Ownership is a server-set, HTTP-only cookie holding an
 * unguessable id; every query is scoped by it, so one visitor cannot read or
 * mutate another's records. The cookie is signed so a client cannot mint its way
 * into someone else's scope by editing the value, and the signature covers only
 * the id — no secret is stored client-side.
 *
 * Why a signed value rather than a bare id: an unsigned cookie is trivially
 * guessed or edited, which would turn "anonymous" into "anybody's".
 */

import { cookies } from "next/headers";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "mintline_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Signing key.
 *
 * In production this comes from the environment. Locally a per-process random
 * key is generated, which is correct for development: restarting the dev server
 * invalidates old sessions, and that is the desired behaviour.
 */
function sessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const globalKey = globalThis as unknown as { __mintlineSessionSecret?: string };
  if (!globalKey.__mintlineSessionSecret) {
    globalKey.__mintlineSessionSecret = randomBytes(32).toString("hex");
  }
  return globalKey.__mintlineSessionSecret;
}

function sign(id: string): string {
  return createHmac("sha256", sessionSecret()).update(id).digest("base64url");
}

export function encodeSession(id: string): string {
  return `${id}.${sign(id)}`;
}

export function decodeSession(value: string | undefined): string | null {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;

  const id = value.slice(0, separator);
  const signature = value.slice(separator + 1);

  if (!/^s_[0-9a-f]{36}$/.test(id)) return null;

  const expected = sign(id);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return id;
}

export function newSessionId(): string {
  return `s_${randomBytes(18).toString("hex")}`;
}

export interface SessionContext {
  sessionId: string;
  /** True when a new cookie must be written back to the client. */
  isNew: boolean;
  /** The signed value to persist, when `isNew`. */
  value: string;
}

export async function getSession(): Promise<SessionContext> {
  const jar = await cookies();
  const existing = decodeSession(jar.get(SESSION_COOKIE)?.value);

  if (existing) {
    return { sessionId: existing, isNew: false, value: "" };
  }

  const id = newSessionId();
  return { sessionId: id, isNew: true, value: encodeSession(id) };
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};

/** Serialize the options into a `Set-Cookie` value. */
export function serializeSessionCookie(
  options: typeof SESSION_COOKIE_OPTIONS = SESSION_COOKIE_OPTIONS,
): string {
  const parts = [
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    `SameSite=${options.sameSite === "lax" ? "Lax" : "Strict"}`,
  ];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

/** Build the full `Set-Cookie` header value for a new session. */
export function sessionCookieHeader(value: string): string {
  return `${SESSION_COOKIE}=${value}; ${serializeSessionCookie()}`;
}

/* ------------------------------------------------------------------ *
 * Best-effort abuse control
 * ------------------------------------------------------------------ */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. */
  retryAfterSeconds: number;
  scope: "memory" | "none";
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Fixed-window limiter held in process memory.
 *
 * This is deliberately documented as best-effort: a serverless deployment can
 * run many instances, so an in-memory bucket is per-instance, not global. It
 * stops casual scripted abuse against one warm instance and nothing more. A
 * genuinely global limit needs a hosted store, and the README says so rather
 * than implying this is stronger than it is.
 */
export function rateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    if (buckets.size > 5_000) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }
    }
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: windowSeconds, scope: "memory" };
  }

  existing.count += 1;
  const allowed = existing.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    scope: "memory",
  };
}

/** Test hook. */
export function resetRateLimits(): void {
  buckets.clear();
}