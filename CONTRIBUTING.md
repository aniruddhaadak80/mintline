# Contributing to Mintline

Thanks for looking at this. It is a small project with a specific opinion about
what it measures, so a short orientation first.

## What Mintline claims to do

It measures whether a Solana token's identity collides with something already
registered, using on-chain metadata plus a deterministic weighted engine. It
does **not** predict price and does **not** tell you whether a token is a good
investment. If a change makes it sound like it does, that change is wrong.

## Getting it running

```bash
git clone https://github.com/aniruddhaadak80/mintline.git
cd mintline
npm install
npm run dev
```

No environment variables are required. Without `DATABASE_URL` the app runs on an
embedded PGlite database in `.mintline-data/`, so the full CRUD loop, the MCP
endpoint and the chain replay all work offline.

## The four commands that must pass

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest
npm run build       # next build
```

Plus the journey check, which boots a production server and walks the whole
product loop over real HTTP:

```bash
npm run build
node scripts/smoke.mjs
```

Against a deployed alias:

```bash
BASE_URL=https://<alias>.vercel.app node scripts/smoke.mjs
```

## Where things live

| Concern | File |
| --- | --- |
| The engine | `src/lib/engine/assay.ts` |
| The two comparators | `src/lib/engine/similarity.ts` (server), `src/lib/engine/embed.ts` (browser) |
| The seal rule | `src/lib/integrity/chain.ts`, `src/lib/integrity/canonical.ts` |
| On-chain decoding | `src/lib/solana/address.ts`, `src/lib/solana/metadata.ts` |
| Storage adapters | `src/lib/db/sql.ts` |
| Every write | `src/lib/db/repository.ts` |

## Rules that are not negotiable

1. **One engine.** `runAssay` in `src/lib/engine/assay.ts` is the only place a
   score is computed. Never reimplement a factor in a component or a route.
2. **One service layer.** Mutations go through `src/lib/db/repository.ts`. The
   UI and the MCP tools both call it, and that is what makes the claim "the
   agent mutates through the same path as the UI" true rather than aspirational.
3. **Parameterize everything.** No user input is ever interpolated into SQL.
4. **Never present a missing reading as a zero.** If a factor cannot be
   measured it is marked `unavailable`, contributes zero and flags the result
   `degraded`. Do not quietly rebalance the remaining weights.
5. **Never present fallback data as live.** Sealed samples always carry
   `status: "fallback"` and the capture timestamp.
6. **Deletion is a tombstone.** The row must survive so its chain stays
   replayable.
7. **Bump `ENGINE_VERSION` when the scoring changes.** Scores are only comparable
   within a version, and the version is printed in every dossier.
8. **Do not suppress lint rules or add `eslint-disable`.** The React Compiler
   rules in particular are catching real cascading-render bugs.

## Adding a factor

1. Add the key to `FactorKey` in `src/lib/types.ts`.
2. Give it a weight in `ENGINE_WEIGHTS` and **renormalise the total to exactly
   1.00** — a test asserts this.
3. Implement it in `src/lib/engine/assay.ts` returning a `Factor` with a real
   `evidence` string built from measured values.
4. Bump `ENGINE_VERSION`.
5. Add tests for normal, boundary, unavailable and degenerate inputs.

## Adding an MCP tool

1. Add the tool to `TOOLS` in `src/lib/mcp/server.ts` with a real JSON Schema.
2. Implement a `case` in `callTool` that calls a `repository` function. Never
   write SQL in the tool.
3. Accept an `idempotency_key` if the tool mutates.
4. Set `annotations.readOnlyHint` and `annotations.destructiveHint` honestly —
   a test asserts that only `retire_origin` is destructive.

## Pull requests

- One concern per PR.
- Say what you actually ran. "Tests pass" without the command is not evidence.
- If you change the engine, include the before/after score for at least one real
  mint so the change can be judged.
- If you touch the seal rule, the genesis vector in
  `tests/integrity.test.ts` will fail. That is deliberate. Do not update the
  vector to make it green unless you are deliberately breaking chain
  compatibility, and say so explicitly in the PR.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Please do not open a public issue.

MIT licensed.