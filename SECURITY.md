# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| `main` | yes |

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Email the maintainer directly, or use GitHub's private vulnerability reporting
on this repository if it is enabled. Include:

- what an attacker can do,
- the exact request or route that demonstrates it,
- the impact you expect.

You can expect an acknowledgement within a few days and a fix or a mitigation
plan once the report is confirmed.

## What this application deliberately does not do

Mintline reads public Solana state. It never asks for a wallet, a signature, a
private key, or an API key, and it has no code path that accepts one. If you find
code that does, that is a vulnerability.

## Threat model

| Area | Mitigation |
| --- | --- |
| **Ownership** | Every row carries a `session_id` derived from a signed, HTTP-only, `SameSite=Lax` cookie. Reads and writes are filtered by it. Another session receives `404`, never `403`, so the API does not confirm a record exists. |
| **Session forgery** | The cookie value is `id.HMAC-SHA256(id)`. The signature is compared in constant time. An unsigned or edited value is rejected and a new session is issued. |
| **Injection** | All SQL is parameterized. No user input is interpolated into a statement. Identifiers are drawn from a fixed internal set only. |
| **SSRF** | Off-chain token metadata is fetched only from an allow-list of IPFS, Arweave and NFT.Storage hosts, over HTTPS, with a time budget and a bounded retry. Arbitrary hosts are never requested. |
| **Denial of service** | Every upstream call has a timeout and a bounded retry count. Anonymous writes are rate limited. See the caveat below. |
| **Error leakage** | Error responses carry a stable code and a message written for the caller. Stack traces, SQL and environment values are never serialised. `handleError` maps anything unrecognised to a generic `500`. |
| **Tampering with history** | Each record has an append-only SHA-384 chain. Editing a stored payload breaks the replay, and `/api/integrity/replay` names the first bad sequence number. Deletion is a soft tombstone so a chain stays replayable. |
| **Supply chain** | CI runs `npm ci` from the committed lockfile, then typecheck, lint, test and build. |

### Rate limiting is best-effort on serverless

The anonymous write limiter is a fixed window held in process memory. On a
serverless platform that window is **per instance**, so it raises the cost of
casual scripted abuse but is not a global limit. A deployment that needs a hard
global cap must add a hosted limiter (Upstash Redis, Vercel KV, or an edge
rate-limit rule) in front of the write routes.

## Third-party trust

- **Solana RPC, DexScreener, Jupiter** return data that Mintline displays. They
  are not under this project's control. A compromised or wrong response would
  produce a wrong score, which is why every factor carries the raw evidence
  string it was computed from.
- **`Xenova/all-MiniLM-L6-v2`** is loaded in the visitor's browser from the
  Hugging Face CDN. It is Apache-2.0 and runs locally; weights are not executed
  on the server.
- User-created claims are public within their own session and become publicly
  readable **only** when their owner explicitly issues a share token. Revoking
  the token removes the link immediately.

## Data retention

Claims are anonymous and scoped to a browser session. There are no accounts, no
emails and no personal data. Retired claims are retained as tombstones because
removing them would break the audit chain they belong to.