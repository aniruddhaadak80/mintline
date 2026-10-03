/**
 * Time-bounded JSON fetching with bounded retries and a typed failure mode.
 *
 * Every upstream call in this product goes through `fetchJson`, so there is a
 * single place that decides how long we wait, how often we retry, and what a
 * failure looks like. Nothing downstream ever sees an unhandled rejection from
 * a third party, and a failure is always data (`ok: false`), never an exception
 * escaping to a route handler.
 */

import type { SourceAttribution, SourceStatus } from "./types";

export interface FetchOk<T> {
  ok: true;
  data: T;
  status: SourceStatus;
  fetchedAt: string;
  httpStatus: number;
}

export interface FetchFail {
  ok: false;
  error: string;
  status: SourceStatus;
  fetchedAt: string;
  httpStatus: number | null;
}

export type FetchResult<T> = FetchOk<T> | FetchFail;

export interface FetchJsonOptions {
  /** Total budget for the whole call including retries. */
  timeoutMs?: number;
  /** Extra attempts after the first. Default 1. */
  retries?: number;
  /** Cache lifetime for Next's data cache. Default 120s. */
  revalidateSeconds?: number;
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  /** Status codes worth retrying. Default 429 and 5xx. */
  retryStatuses?: number[];
}

const DEFAULT_TIMEOUT = 9_000;

/** Hosts this app is allowed to read metadata JSON from. */
const ALLOWED_METADATA_HOSTS = new Set([
  "arweave.net",
  "www.arweave.net",
  "gateway.arweave.net",
  "ipfs.io",
  "cloudflare-ipfs.com",
  "nftstorage.link",
  "metadata.ledger.ping",
]);

export function isAllowedMetadataUrl(input: string): boolean {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:") return false;
    return ALLOWED_METADATA_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export async function fetchJson<T>(
  url: string,
  options: FetchJsonOptions = {},
): Promise<FetchResult<T>> {
  const {
    timeoutMs = DEFAULT_TIMEOUT,
    retries = 1,
    revalidateSeconds = 120,
    method = "GET",
    body,
    headers = {},
    retryStatuses = [429, 500, 502, 503, 504],
  } = options;

  const fetchedAt = new Date().toISOString();
  let lastError = "unknown error";
  let lastStatus: number | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    // The retry budget is a fraction of the total, so a slow attempt cannot
    // consume the entire timeout and starve the ones after it.
    const slice = Math.max(1_000, Math.floor(timeoutMs / (retries + 1)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), slice);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          accept: "application/json",
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        // Next extends RequestInit with a data-cache hint; the DOM type does
        // not know about it.
        ...({ next: { revalidate: revalidateSeconds } } as Record<string, unknown>),
      } as RequestInit);

      clearTimeout(timer);
      lastStatus = response.status;

      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        if (!retryStatuses.includes(response.status) || attempt === retries) {
          return { ok: false, error: lastError, status: "fallback", fetchedAt, httpStatus: response.status };
        }
      } else {
        const text = await response.text();
        try {
          return {
            ok: true,
            data: JSON.parse(text) as T,
            status: "live",
            fetchedAt,
            httpStatus: response.status,
          };
        } catch {
          return {
            ok: false,
            error: "response was not valid JSON",
            status: "fallback",
            fetchedAt,
            httpStatus: response.status,
          };
        }
      }
    } catch (error) {
      clearTimeout(timer);
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return { ok: false, error: lastError, status: "fallback", fetchedAt, httpStatus: lastStatus };
}

export function attribution(
  id: string,
  label: string,
  homepage: string,
  endpoint: string,
  result: { status: SourceStatus; fetchedAt: string; error?: string },
): SourceAttribution {
  return {
    id,
    label,
    homepage,
    endpoint,
    fetchedAt: result.fetchedAt,
    status: result.status,
    ...(result.error ? { note: result.error } : {}),
  };
}