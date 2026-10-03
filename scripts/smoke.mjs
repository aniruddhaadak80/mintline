/**
 * Primary-journey smoke test.
 *
 * Walks the complete product loop using real HTTP: discover → create →
 * read back → decide → engine → agent mutation → integrity replay → export →
 * delete → confirm tombstone.
 *
 * By default it boots its own production server so the run is self-contained:
 *
 *   npm run build && node scripts/smoke.mjs
 *
 * To test an already-running deployment instead:
 *
 *   BASE_URL=https://<alias>.vercel.app node scripts/smoke.mjs
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";

const BOOT = !process.env.BASE_URL;
const PORT = Number(process.env.PORT || 3151);
const BASE = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const MINT = process.env.SMOKE_MINT || "So11111111111111111111111111111111111111112";

let server = null;

async function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 1500);
  });
}

async function boot() {
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.on("data", () => {});
  server.stderr.on("data", () => {});

  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (await portOpen(PORT)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`server did not open port ${PORT}`);
}

async function shutdown() {
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await Promise.race([once(server, "exit"), new Promise((r) => setTimeout(r, 4000))]);
  }
}

/**
 * A session may claim a given mint only once, so each registration in this
 * script takes the next mint from the pool. Re-using one would be (correctly)
 * rejected with a 409, which is a property of the product, not a failure.
 */
const MINT_POOL = [
  MINT,
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
];
let mintCursor = 0;
function nextMint() {
  const value = MINT_POOL[mintCursor % MINT_POOL.length];
  mintCursor += 1;
  return value;
}

let cookie = "";
let passed = 0;
let failed = 0;
const failures = [];

function record(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return { status: response.status, json: await response.json(), headers: response.headers };
  }
  return { status: response.status, text: await response.text(), headers: response.headers };
}

async function rpc(method, params) {
  const result = await call("POST", "/api/mcp", {
    jsonrpc: "2.0",
    id: Math.floor(Math.random() * 100000),
    method,
    ...(params ? { params } : {}),
  });
  return result.json;
}

console.log(`\nMintline journey — ${BASE}${BOOT ? " (booted locally)" : ""}\n`);

if (BOOT) await boot();

/* 1. Landing and navigation ---------------------------------------- */
{
  const home = await call("GET", "/");
  record("GET / returns 200", home.status === 200, `status ${home.status}`);

  const body = typeof home.text === "string" ? home.text : JSON.stringify(home.json ?? {});
  record(
    "landing page links the public repository",
    body.includes("https://github.com/aniruddhaadak80/mintline"),
  );
  record("landing page carries the GitHub CTA", /View source|Star on GitHub/.test(body));
  record("landing page shows the engine version", body.includes("mintline-assay-v1"));
}

/* 2. Health --------------------------------------------------------- */
let health;
{
  const result = await call("GET", "/api/health");
  health = result.json;
  record("GET /api/health returns 200", result.status === 200, `status ${result.status}`);
  record("health reports a real store check", health?.store?.reachable === true);
  record("health names the adapter in use", typeof health?.store?.adapter === "string");
}

/* 3. Live data ------------------------------------------------------ */
let live;
{
  const result = await call("GET", `/api/mint?mint=${MINT}`);
  live = result.json;
  record("live mint endpoint returns 200", result.status === 200, `status ${result.status}`);
  record("live response carries source attribution", Array.isArray(live?.sources) && live.sources.length > 0);
  record(
    "sources are labelled live or fallback",
    (live?.sources || []).every((s) => ["live", "stale", "fallback"].includes(s.status)),
  );
  record("fetched timestamps are present", (live?.sources || []).every((s) => Boolean(s.fetchedAt)));
}

/* 4. Engine --------------------------------------------------------- */
let assay;
{
  const result = await call("POST", "/api/assay", { mint: MINT });
  assay = result.json;
  record("POST /api/assay returns 200", result.status === 200, `status ${result.status}`);
  record("engine version is stamped", assay?.result?.engineVersion === "mintline-assay-v1.0.0");
  record("score is inside 0..100", typeof assay?.result?.score === "number" && assay.result.score >= 0 && assay.result.score <= 100);
  record("verdict is classified", typeof assay?.result?.verdict === "string");
  record("factors are itemized", Array.isArray(assay?.result?.factors) && assay.result.factors.length === 6);
  record(
    "every factor carries evidence",
    (assay?.result?.factors || []).every((f) => typeof f.evidence === "string" && f.evidence.length > 0),
  );
  record("factor points sum to the score", (() => {
    const sum = (assay?.result?.factors || []).reduce((t, f) => t + f.points, 0);
    return Math.abs(sum - assay.result.score) < 0.2;
  })());
  record("comparator is named", typeof assay?.similarity?.model === "string");
  record("engine response includes a seal reference field", "verificationRef" in (assay?.result || {}));
}

/* 5. Create --------------------------------------------------------- */
let originId = null;
{
  const claimMint = nextMint();
  const result = await call("POST", "/api/origins", {
    mint: claimMint,
    name: `Smoke Origin ${Date.now()}`,
    idempotencyKey: `smoke-${Date.now()}`,
  });
  originId = result.json?.origin?.id ?? null;
  record("POST /api/origins returns 201", result.status === 201, `status ${result.status} ${JSON.stringify(result.json?.error ?? "")}`);
  record("created record has an id", typeof originId === "string" && originId.length > 0);
  record("created record carries a server-computed score", typeof result.json?.score === "number");
  record("record starts a sealed chain", /^[0-9a-f]{96}$/.test(result.json?.origin?.chainHead || ""));
  record("record has one audit event", result.json?.origin?.eventCount === 1);
}

/* 6. Read back ------------------------------------------------------ */
{
  const result = await call("GET", `/api/origins/${originId}`);
  record("GET /api/origins/:id returns 200", result.status === 200, `status ${result.status}`);
  record("read-back matches the created id", result.json?.origin?.id === originId);
  record("read-back preserved the assay", typeof result.json?.origin?.assay?.score === "number");
}

/* 7. Idempotent create ---------------------------------------------- */
{
  const idemMint = nextMint();
  const key = `smoke-idem-${Date.now()}`;
  const first = await call("POST", "/api/origins", { mint: idemMint, name: "Idem First", idempotencyKey: key });
  const second = await call("POST", "/api/origins", { mint: idemMint, name: "Idem First", idempotencyKey: key });
  record("the first idempotent create returns 201", first.status === 201, `status ${first.status} ${JSON.stringify(first.json?.error ?? "")}`);
  record("a repeated idempotency key returns the first record", first.json?.origin?.id === second.json?.origin?.id);
  record("the repeat is not reported as created", second.json?.created === false);
  await call("DELETE", `/api/origins/${first.json?.origin?.id}`);
}

/* 7b. A second claim on the same mint is a conflict ------------------ */
{
  const dupMint = nextMint();
  const first = await call("POST", "/api/origins", { mint: dupMint, name: "Dup One" });
  const second = await call("POST", "/api/origins", { mint: dupMint, name: "Dup Two" });
  record("claiming the same mint twice returns 409", second.status === 409, `status ${second.status}`);
  record("conflict uses the stable error code", second.json?.error?.code === "conflict");
  if (first.json?.origin?.id) await call("DELETE", `/api/origins/${first.json.origin.id}`);
}

/* 8. Update / decide ------------------------------------------------ */
{
  const result = await call("PATCH", `/api/origins/${originId}`, { status: "disputed", note: "Smoke verdict" });
  record("PATCH records a verdict", result.status === 200, `status ${result.status}`);
  record("status became disputed", result.json?.origin?.status === "disputed");
  record("the chain grew", result.json?.eventCount === 2);
}

/* 9. Re-assay ------------------------------------------------------- */
{
  const result = await call("POST", `/api/origins/${originId}/assay`, {});
  record("re-assay returns 200", result.status === 200, `status ${result.status}`);
  record("re-assay stored a versioned score", typeof result.json?.result?.score === "number");
  record("re-assay returns a verification reference", /^[0-9a-f]{96}$/.test(result.json?.verificationRef || ""));
}

/* 10. MCP: initialize + tools/list ---------------------------------- */
{
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
  record("MCP initialize succeeds", Boolean(init?.result?.protocolVersion), JSON.stringify(init?.error || ""));
  record("MCP advertises the server name", init?.result?.serverInfo?.name === "mintline");

  const list = await rpc("tools/list");
  const tools = list?.result?.tools || [];
  record("MCP tools/list returns tools", tools.length >= 3, `${tools.length} tools`);
  record("MCP exposes a read tool", tools.some((t) => t.name === "list_origins"));
  record("MCP exposes an analysis tool", tools.some((t) => t.name === "assay_mint"));
  record("MCP exposes a mutating tool", tools.some((t) => t.name === "register_origin"));
  record("every tool has an input schema", tools.every((t) => t.inputSchema?.type === "object"));

  const bad = await rpc("tools/call", { name: "assay_mint", arguments: {} });
  record("MCP rejects a missing argument with -32602", bad?.error?.code === -32602);
}

/* 11. MCP mutation through the same path --------------------------- */
let agentOriginId = null;
{
  const agentMint = nextMint();
  const result = await rpc("tools/call", {
    name: "register_origin",
    arguments: { mint: agentMint, name: `Agent Origin ${Date.now()}`, idempotency_key: `agent-smoke-${Date.now()}` },
  });
  agentOriginId = result?.result?.structuredContent?.origin?.id ?? null;
  record(
    "MCP mutating tool creates a record",
    typeof agentOriginId === "string",
    JSON.stringify(result?.error ?? result?.result?.content?.[0]?.text ?? ""),
  );
  record("MCP mutation returns a chain head", /^[0-9a-f]{96}$/.test(result?.result?.structuredContent?.chainHead || ""));

  const readBack = await call("GET", `/api/origins/${agentOriginId}`);
  record("the agent's write is visible through the REST API", readBack.status === 200 && readBack.json?.origin?.id === agentOriginId);

  const listAfter = await call("GET", "/api/origins?limit=100");
  record(
    "the agent's record appears in the registry listing",
    (listAfter.json?.items || []).some((item) => item.id === agentOriginId),
  );
}

/* 12. Integrity replay ---------------------------------------------- */
{
  const result = await call("GET", `/api/integrity/replay?id=${originId}`);
  record("integrity replay returns 200", result.status === 200, `status ${result.status}`);
  record("replay reports ok", result.json?.ok === true, result.json?.brokenReason || "");
  record("replay checked every event", result.json?.checked === 3, `checked ${result.json?.checked}`);
  record("replay returns a genesis", /^[0-9a-f]{96}$/.test(result.json?.genesis || ""));
  record("replay returns the chain head", /^[0-9a-f]{96}$/.test(result.json?.headSeal || ""));
}

/* 13. Export -------------------------------------------------------- */
{
  const md = await call("GET", `/api/export?id=${originId}&format=md`);
  record("markdown dossier returns 200", md.status === 200, `status ${md.status}`);
  record("markdown dossier downloads as a file", (md.headers.get("content-disposition") || "").includes("attachment"));
  record("markdown dossier contains the factor table", md.text.includes("## Factor breakdown"));
  record("markdown dossier contains the chain", md.text.includes("## Integrity chain"));
  record("markdown dossier carries the disclaimer", md.text.includes("not financial advice"));
  record("markdown dossier attributes sources", md.text.includes("## Sources"));

  const json = await call("GET", `/api/export?id=${originId}&format=json`);
  record("json dossier returns 200", json.status === 200);
  record("json dossier has the documented schema", json.json?.schema === "mintline.dossier/1");
  record("json dossier includes the engine version", typeof json.json?.provenance?.engineVersion === "string");
}

/* 14. Share link ---------------------------------------------------- */
let sharePath = null;
{
  const result = await rpc("tools/call", {
    name: "share_origin",
    arguments: { origin_id: originId },
  });
  sharePath = result?.result?.structuredContent?.sharePath ?? null;
  record("share token is issued", typeof sharePath === "string" && sharePath.startsWith("/share/"));

  if (sharePath) {
    const shared = await call("GET", sharePath);
    record("shared dossier is publicly readable", shared.status === 200, `status ${shared.status}`);
    record("shared dossier shows the origin", shared.text.includes("Smoke Origin"));
  }
}

/* 15. Ownership boundary ------------------------------------------- */
{
  const isolated = await fetch(`${BASE}/api/origins/${originId}`, { headers: { cookie: "mintline_session=s_0000000000000000000000000000000000000000.invalid" } });
  record("a forged session cookie is rejected", isolated.status >= 400, `status ${isolated.status}`);
}

/* 16. Validation ---------------------------------------------------- */
{
  const badMint = await call("POST", "/api/assay", { mint: "nope" });
  record("invalid mint returns 400", badMint.status === 400, `status ${badMint.status}`);
  record("error envelope is stable", badMint.json?.error?.code === "invalid_request");

  const missing = await call("GET", "/api/origins/o_definitely_not_a_real_id");
  record("unknown record returns 404", missing.status === 404, `status ${missing.status}`);
  record("404 uses the stable error code", missing.json?.error?.code === "not_found");

  const badExport = await call("GET", "/api/export?id=nope");
  record("export rejects a malformed id", badExport.status === 400 || badExport.status === 404);
}

/* 17. All routes reachable ------------------------------------------ */
for (const path of ["/", "/registry", "/assay", "/chain", "/agent", "/export", "/settings", "/mcp.json", "/sitemap.xml", "/robots.txt"]) {
  const result = await fetch(`${BASE}${path}`);
  record(`route ${path} returns 200`, result.status === 200, `status ${result.status}`);
}

/* 18. Delete and confirm tombstone ---------------------------------- */
{
  const result = await call("DELETE", `/api/origins/${originId}`);
  record("DELETE returns 200", result.status === 200, `status ${result.status}`);
  record("delete reports a tombstone", result.json?.tombstone === true);
  record("tombstone remains replayable", result.json?.replayable === true);
  record("tombstone retained the chain head", /^[0-9a-f]{96}$/.test(result.json?.chainHead || ""));

  const listing = await call("GET", "/api/origins?limit=100");
  record(
    "tombstone is hidden from the default listing",
    !(listing.json?.items || []).some((item) => item.id === originId),
  );

  const replay = await call("GET", `/api/integrity/replay?id=${originId}`);
  record("tombstone chain still replays clean", replay.json?.ok === true, replay.json?.brokenReason || "");
}

/* 19. Clean up the agent record ------------------------------------- */
if (agentOriginId) {
  await call("DELETE", `/api/origins/${agentOriginId}`);
  const replay = await call("GET", `/api/integrity/replay?id=${agentOriginId}`);
  record("agent record cleaned up and still replayable", replay.json?.ok === true);
}

/* Summary ------------------------------------------------------------ */
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log("Failures:");
  for (const failure of failures) console.log(`  - ${failure}`);
}

await shutdown();

if (failed > 0) process.exit(1);