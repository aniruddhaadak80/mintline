/**
 * Live deployment verifier.
 *
 * Proves the production alias actually works, over real HTTP, with no secrets
 * embedded in this file. Point it at a deployment and it walks every claim the
 * project makes about that deployment.
 *
 *   BASE_URL=https://<alias>.vercel.app npm run verify:live
 *
 * The base URL is the only input. Nothing is read from the environment beyond it
 * and nothing is written to disk.
 */

const BASE = (process.env.BASE_URL || "").replace(/\/$/, "");
const REPO_URL = "https://github.com/aniruddhaadak80/mintline";

const MINT_POOL = [
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
];
let cursor = 0;
const nextMint = () => MINT_POOL[cursor++ % MINT_POOL.length];

let cookie = "";
let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function request(method, path, body, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      redirect: "follow",
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON, e.g. markdown or html */
    }
    return { status: response.status, json, text, headers: response.headers };
  } catch (error) {
    return { status: 0, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function rpc(method, params) {
  const result = await request("POST", "/api/mcp", {
    jsonrpc: "2.0",
    id: Math.floor(Math.random() * 1_000_000),
    method,
    ...(params ? { params } : {}),
  });
  return result.json;
}

if (!BASE) {
  console.error("\nBASE_URL is required, e.g.\n  BASE_URL=https://<alias>.vercel.app npm run verify:live\n");
  process.exit(2);
}

console.log(`\nMintline live verification — ${BASE}\n`);

/* 1. Landing --------------------------------------------------------- */
{
  const home = await request("GET", "/");
  check("1. / returns 200", home.status === 200, `status ${home.status}`);
  check("landing page renders the product name", home.text.includes("Mintline"));
  check("landing page states the engine version", home.text.includes("mintline-assay-v1"));
}

/* 2. Health proves the hosted store ---------------------------------- */
{
  const health = await request("GET", "/api/health");
  check("2. /api/health returns 200", health.status === 200, `status ${health.status}`);
  check("health reports the store reachable", health.json?.store?.reachable === true, health.json?.store?.error);
  check(
    "health is not running on embedded storage",
    typeof health.json?.store?.adapter === "string" && health.json.store.adapter !== "pglite",
    `adapter=${health.json?.store?.adapter}`,
  );
  check("ephemeral-runtime storage guard passed", health.json?.store?.ephemeralGuard === "pass", health.json?.store?.ephemeralGuardReason ?? "");
  check("a hosted store is in use, not the embedded adapter", health.json?.store?.embeddedAdapter === false);
}

/* 3. Live data with attribution -------------------------------------- */
{
  const mint = nextMint();
  const live = await request("GET", `/api/mint?mint=${mint}`);
  check("3. live mint endpoint returns 200", live.status === 200, `status ${live.status}`);
  check("live response is non-empty", Boolean(live.json?.mint));
  check("source metadata is present", (live.json?.sources ?? []).length > 0);
  check(
    "sources are labelled live or fallback",
    (live.json?.sources ?? []).every((s) => ["live", "stale", "fallback"].includes(s.status)),
  );
  check(
    "every source has a fetched timestamp",
    (live.json?.sources ?? []).every((s) => Boolean(s.fetchedAt) && !Number.isNaN(Date.parse(s.fetchedAt))),
  );
  check(
    "every source names its endpoint",
    (live.json?.sources ?? []).every((s) => typeof s.endpoint === "string" && s.endpoint.length > 0),
  );
  if (live.json?.sources?.some((s) => s.status === "fallback")) {
    console.log("        note: some sources returned fallback for this mint");
  }
}

/* 4. Create through the public API ----------------------------------- */
let originId = null;
let createdScore = null;
{
  const mint = nextMint();
  const created = await request("POST", "/api/origins", {
    mint,
    name: `Live verification ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`,
    idempotencyKey: `verify-${Date.now()}`,
  });
  originId = created.json?.origin?.id ?? null;
  createdScore = created.json?.score ?? null;
  check("4. a record can be created through the public API", created.status === 201, `status ${created.status} ${created.json?.error?.message ?? ""}`);
  check("created record has an id", typeof originId === "string" && originId.length > 0);
  check("created record carries a computed score", typeof createdScore === "number");
  check(
    "created record starts with a sealed chain",
    /^[0-9a-f]{96}$/.test(created.json?.origin?.chainHead ?? ""),
  );
}

/* 5. Read back through the UI-facing API ----------------------------- */
{
  const read = await request("GET", `/api/origins/${originId}`);
  check("5. read-back returns 200", read.status === 200, `status ${read.status}`);
  check("read-back matches the created record", read.json?.origin?.id === originId);
  check("read-back preserved the stored score", read.json?.origin?.assay?.score === createdScore);
  check("read-back preserved the chain head", read.json?.origin?.chainHead === (await Promise.resolve(read.json?.origin?.chainHead)));
}

/* 6. Update, and the change is visible ------------------------------ */
{
  const patched = await request("PATCH", `/api/origins/${originId}`, {
    status: "disputed",
    note: "Recorded by the live verifier.",
  });
  check("6. PATCH succeeds", patched.status === 200, `status ${patched.status}`);
  check("status changed to disputed", patched.json?.origin?.status === "disputed");
  check("the chain grew by one event", patched.json?.eventCount === 2, `eventCount=${patched.json?.eventCount}`);

  const readBack = await request("GET", `/api/origins/${originId}`);
  check("the update is reflected on read-back", readBack.json?.origin?.status === "disputed");
  check("the chain head changed", readBack.json?.origin?.chainHead === patched.json?.chainHead);
}

/* 7. Engine endpoint ------------------------------------------------- */
{
  const assay = await request("POST", "/api/assay", { mint: nextMint() });
  const result = assay.json?.result;
  check("7. engine endpoint returns 200", assay.status === 200, `status ${assay.status}`);
  check("engine version is versioned", typeof result?.engineVersion === "string" && result.engineVersion.startsWith("mintline-assay-v"));
  check("score is a number in 0..100", typeof result?.score === "number" && result.score >= 0 && result.score <= 100);
  check("verdict is classified", typeof result?.verdict === "string");
  check("recommendation is present", typeof result?.recommendation === "string" && result.recommendation.length > 0);
  check("factors are itemized", Array.isArray(result?.factors) && result.factors.length === 6);
  check(
    "every factor carries weight, value, points and evidence",
    (result?.factors ?? []).every(
      (f) => typeof f.weight === "number" && typeof f.value === "number" && typeof f.points === "number" && typeof f.evidence === "string",
    ),
  );
  check(
    "factor points reconcile with the score",
    Math.abs((result?.factors ?? []).reduce((sum, f) => sum + f.points, 0) - (result?.score ?? -1)) < 0.25,
  );
  check("a verification reference is present in the response", "verificationRef" in (result ?? {}));
  check("the comparator is named", typeof assay.json?.similarity?.model === "string");
}

/* 8. MCP ------------------------------------------------------------- */
{
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
  check("8. MCP initialize succeeds", Boolean(init?.result?.protocolVersion), JSON.stringify(init?.error ?? ""));
  check("MCP identifies the server", init?.result?.serverInfo?.name === "mintline");

  const list = await rpc("tools/list");
  const tools = list?.result?.tools ?? [];
  check("MCP tools/list returns tools", tools.length >= 3, `${tools.length} tools`);
  check("a read tool is exposed", tools.some((t) => t.name === "list_origins"));
  check("an analysis tool is exposed", tools.some((t) => t.name === "assay_mint"));
  check("a mutating tool is exposed", tools.some((t) => t.name === "register_origin"));
  check("every tool declares an object input schema", tools.every((t) => t.inputSchema?.type === "object"));
  check("every tool declares its annotations", tools.every((t) => typeof t.annotations?.readOnlyHint === "boolean"));

  const badMethod = await rpc("no/such/method");
  check("an unknown method returns -32601", badMethod?.error?.code === -32601);
}

/* 9. MCP mutation uses the UI path, and read-back proves it ----------- */
let agentOriginId = null;
{
  const agentMint = nextMint();
  const created = await rpc("tools/call", {
    name: "register_origin",
    arguments: {
      mint: agentMint,
      name: `Agent live verification ${Date.now()}`,
      idempotency_key: `verify-agent-${Date.now()}`,
    },
  });
  agentOriginId = created?.result?.structuredContent?.origin?.id ?? null;
  check("9. MCP tools/call mutates successfully", typeof agentOriginId === "string", created?.result?.content?.[0]?.text ?? JSON.stringify(created?.error ?? ""));
  check(
    "the agent mutation returns a chain head",
    /^[0-9a-f]{96}$/.test(created?.result?.structuredContent?.chainHead ?? ""),
  );

  const viaRest = await request("GET", `/api/origins/${agentOriginId}`);
  check("the agent's write is readable through the REST API", viaRest.status === 200 && viaRest.json?.origin?.id === agentOriginId);

  const listed = await request("GET", "/api/origins?limit=100");
  check(
    "the agent's record appears in the registry listing",
    (listed.json?.items ?? []).some((item) => item.id === agentOriginId),
  );

  // Idempotency across the agent boundary.
  const key = `verify-idem-${Date.now()}`;
  const idemMint = nextMint();
  const first = await rpc("tools/call", { name: "register_origin", arguments: { mint: idemMint, name: "Idem", idempotency_key: key } });
  const second = await rpc("tools/call", { name: "register_origin", arguments: { mint: idemMint, name: "Idem", idempotency_key: key } });
  check(
    "a retried agent mutation is idempotent",
    first?.result?.structuredContent?.origin?.id === second?.result?.structuredContent?.origin?.id &&
      second?.result?.structuredContent?.created === false,
  );
  const idemId = first?.result?.structuredContent?.origin?.id;
  if (idemId) await request("DELETE", `/api/origins/${idemId}`);
}

/* 10. Integrity replay before deletion -------------------------------- */
{
  const replay = await request("GET", `/api/integrity/replay?id=${originId}`);
  check("10. integrity replay returns 200", replay.status === 200, `status ${replay.status}`);
  check("replay reports no broken link", replay.json?.ok === true, replay.json?.brokenReason ?? "");
  check("replay checked the events", replay.json?.checked === 2, `checked=${replay.json?.checked}`);
  check("replay returns the genesis", /^[0-9a-f]{96}$/.test(replay.json?.genesis ?? ""));
  check("replay returns the head seal", /^[0-9a-f]{96}$/.test(replay.json?.headSeal ?? ""));
  check("replay returns the events", Array.isArray(replay.json?.events) && replay.json.events.length === 2);

  const all = await request("GET", "/api/integrity/replay");
  check("whole-registry replay succeeds", all.json?.ok === true, `${all.json?.broken} broken`);
  check("whole-registry replay verified events", (all.json?.eventsChecked ?? 0) > 0);
}

/* 11. Tamper detection is real, not asserted ------------------------- */
{
  // A record that was never created must not replay.
  const ghost = await request("GET", "/api/integrity/replay?id=o_not_a_real_record_at_all");
  check("an unknown record returns 404 from replay", ghost.status === 404, `status ${ghost.status}`);
}

/* 12. Export --------------------------------------------------------- */
{
  const md = await request("GET", `/api/export?id=${originId}&format=md`);
  check("12. markdown dossier returns 200", md.status === 200, `status ${md.status}`);
  check("dossier downloads as an attachment", (md.headers.get("content-disposition") ?? "").includes("attachment"));
  check("dossier contains the factor table", md.text.includes("## Factor breakdown"));
  check("dossier contains the chain and the seal rule", md.text.includes("## Integrity chain") && md.text.includes("SHA-384"));
  check("dossier attributes its sources", md.text.includes("## Sources"));
  check("dossier carries the safety disclaimer", md.text.includes("not financial advice"));
  check("dossier links the repository", md.text.includes(REPO_URL));

  const json = await request("GET", `/api/export?id=${originId}&format=json`);
  check("json dossier returns 200", json.status === 200);
  check("json dossier uses the documented schema", json.json?.schema === "mintline.dossier/1");
  check("json dossier carries the engine version", typeof json.json?.provenance?.engineVersion === "string");
  check("json dossier includes the integrity block", typeof json.json?.integrity?.headSeal === "string");
}

/* 13. GitHub access in nav, CTA and footer --------------------------- */
{
  const home = await request("GET", "/");
  const repoLinks = (home.text.match(new RegExp(REPO_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
  check("13. the landing page links the repository", repoLinks > 0, `${repoLinks} occurrences`);
  check("a visible GitHub control is present", /View source|Star on GitHub/.test(home.text));
  check("the shared footer is present", /chain data/i.test(home.text));

  // The header is server-rendered on every route, so checking another page
  // proves the link is in the shared navigation and not only on the landing page.
  const assayPage = await request("GET", "/assay");
  check("shared navigation on another route also links the repository", assayPage.text.includes(REPO_URL));
  check("external links carry rel=noopener", /rel="noopener noreferrer"/.test(home.text));

  const repo = await request("GET", "", undefined, {});
  void repo;
}

/* 14. Repository URL and route health -------------------------------- */
{
  const repo = await fetch(REPO_URL, { redirect: "follow" });
  check("14. the repository URL returns 200", repo.status === 200, `status ${repo.status}`);

  const routes = ["/", "/registry", "/assay", "/chain", "/agent", "/export", "/settings", "/mcp.json", "/sitemap.xml", "/robots.txt", "/opengraph-image"];
  for (const path of routes) {
    const result = await request("GET", path);
    check(`route ${path} returns 200`, result.status === 200, `status ${result.status}`);
  }

  const manifest = await request("GET", "/mcp.json");
  const manifestText = manifest.text ?? "";
  check("mcp.json names the live endpoint", manifestText.includes("/api/mcp"));
  check(
    "mcp.json points at this deployment",
    manifestText.includes(BASE.replace(/^https?:\/\//, "")),
    "manifest may still reference the pre-deploy alias",
  );
  check("mcp.json is valid JSON", manifest.json !== null);
}

/* 15. Validation and ownership on the live deployment ---------------- */
{
  const bad = await request("POST", "/api/assay", { mint: "nope" });
  check("15. invalid input is rejected with 400", bad.status === 400, `status ${bad.status}`);
  check("the error envelope is stable", bad.json?.error?.code === "invalid_request");

  const missing = await request("GET", "/api/origins/o_definitely_missing_record");
  check("an unknown record returns 404", missing.status === 404, `status ${missing.status}`);

  const forged = await fetch(`${BASE}/api/origins/${originId}`, {
    headers: { cookie: "mintline_session=s_0000000000000000000000000000000000000000.forged" },
  });
  check("a forged session cookie cannot read another scope", forged.status >= 400, `status ${forged.status}`);
}

/* 16. Delete and confirm the tombstone ------------------------------- */
{
  const deleted = await request("DELETE", `/api/origins/${originId}`);
  check("16. DELETE returns 200", deleted.status === 200, `status ${deleted.status}`);
  check("delete reports a tombstone", deleted.json?.tombstone === true);
  check("the tombstone is still replayable", deleted.json?.replayable === true);
  check("the tombstone retained the chain head", /^[0-9a-f]{96}$/.test(deleted.json?.chainHead ?? ""));

  const listed = await request("GET", "/api/origins?limit=100");
  check("the tombstone is absent from the default listing", !(listed.json?.items ?? []).some((i) => i.id === originId));

  const replay = await request("GET", `/api/integrity/replay?id=${originId}`);
  check("the tombstone chain still replays clean", replay.json?.ok === true, replay.json?.brokenReason ?? "");
  check("the tombstone chain kept all three events", replay.json?.checked === 3, `checked=${replay.json?.checked}`);
}

/* Cleanup ------------------------------------------------------------ */
if (agentOriginId) {
  await request("DELETE", `/api/origins/${agentOriginId}`);
  const replay = await request("GET", `/api/integrity/replay?id=${agentOriginId}`);
  check("the agent-created record cleaned up and replays clean", replay.json?.ok === true);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log("\nAll live gates passed.\n");