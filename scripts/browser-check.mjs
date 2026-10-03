/**
 * Browser verification pass.
 *
 * Drives a real Chromium against the production alias: completes the three
 * jobs-to-be-done through visible controls only, checks keyboard navigation and
 * focus visibility, tests a mobile and a desktop viewport, captures
 * screenshots, and fails on any uncaught error, console error, or failed
 * network request.
 *
 *   BASE_URL=https://<alias>.vercel.app node scripts/browser-check.mjs
 */

import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const BASE = (process.env.BASE_URL || "").replace(/\/$/, "");
const MINT = process.env.SMOKE_MINT || "So11111111111111111111111111111111111111112";
const SHOTS = process.env.SHOT_DIR || "screenshots";

if (!BASE) {
  console.error("\nBASE_URL is required, e.g.\n  BASE_URL=https://<alias>.vercel.app node scripts/browser-check.mjs\n");
  process.exit(2);
}

await mkdir(SHOTS, { recursive: true });

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` â€” ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` â€” ${detail}` : ""}`);
  }
}

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

const browser = await chromium.launch();

async function newPage(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`${page.url()} :: ${message.text()}`);
  });
  page.on("pageerror", (error) => pageErrors.push(`${page.url()} :: ${error.message}`));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "unknown";
    // Ignore aborted navigations, which are normal during route changes.
    if (!failure.includes("ERR_ABORTED")) {
      failedRequests.push(`${request.url()} :: ${failure}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      failedRequests.push(`${response.url()} :: HTTP ${response.status()}`);
    }
  });

  return { context, page };
}

console.log(`\nMintline browser pass â€” ${BASE}\n`);

/* ------------------------------------------------------------------ *
 * Desktop: the three jobs-to-be-done
 * ------------------------------------------------------------------ */
{
  const { context, page } = await newPage({ width: 1440, height: 1000 });

  /* Job 1: a launch team can see whether a name already belongs to someone. */
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  check("job 1: landing renders", (await page.title()).includes("Mintline"));

  await page.fill("#press-mint", MINT);
  await page.getByRole("button", { name: /strike specimen/i }).click();

  // The press resolves server-side first, then upgrades on-device. Wait for the
  // six meters to be present; assert their values separately.
  await page.waitForFunction(
    () => document.querySelectorAll('[role="meter"]').length >= 6,
    undefined,
    { timeout: 150_000 },
  );
  await page.waitForTimeout(8_000);

  const recommendation = await page.locator("text=/recommended action|do not treat this identity|safe to attest|ask the issuer|treat the name as unproven/i").count();
  check("job 1: the engine produced a verdict", recommendation > 0);

  const factorBars = await page.locator('[role="meter"]').count();
  check("job 1: six factors are shown with real values", factorBars === 6, `${factorBars} meters`);

  const meterLabels = await page.evaluate(() =>
    [...document.querySelectorAll('[role="meter"]')].map((m) => m.getAttribute("aria-label") ?? ""),
  );
  check(
    "job 1: every factor meter carries its measured value",
    meterLabels.length === 6 && meterLabels.every((label) => /out of 100/.test(label)),
    meterLabels.slice(0, 2).join(" | "),
  );

  const evidence = await page.locator("text=/liquidity \\$|top \\d+ accounts hold|oldest pair/i").count();
  check("job 1: factors cite measured evidence", evidence > 0);

  // The comparator must be named, whichever one produced the number.
  const comparator = await page.locator("text=/comparator/i").count();
  check("job 1: the comparator that produced the score is named", comparator > 0);

  await page.screenshot({ path: `${SHOTS}/01-assay-press.png`, fullPage: false });

  /* Job 2: register, inspect, decide, re-assay, replay. */
  await page.goto(`${BASE}/registry`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.screenshot({ path: `${SHOTS}/02-registry.png`, fullPage: false });

  await page.getByRole("button", { name: /^show$/i }).click();
  await page.fill("#create-mint", MINT);
  await page.fill("#create-name", `Browser pass ${Date.now()}`);
  await page.fill("#create-symbol", "BPASS");
  await page.fill("#create-note", "Filed by the browser verification pass.");
  await page.getByRole("button", { name: /register origin/i }).click();

  await page.waitForSelector('[data-testid="create-success"]', { timeout: 120_000 });
  check("job 2: an origin was filed through the UI", true);

  await page.locator('[data-testid="create-success"] a').click();
  await page.waitForURL(/\/registry\/o_/, { timeout: 60_000 });
  await page.waitForSelector("text=/factor breakdown/i", { timeout: 60_000 });

  const specimenUrl = page.url();
  check("job 2: the dynamic detail route opened", /\/registry\/o_/.test(specimenUrl));

  const scoreVisible = await page.locator('[role="img"][aria-label*="Provenance integrity"]').count();
  check("job 2: the stamped score is rendered", scoreVisible > 0);

  await page.screenshot({ path: `${SHOTS}/03-specimen-detail.png`, fullPage: false });

  await page.locator('[data-testid="verdict-disputed"]').click();
  await page.waitForSelector('[data-testid="detail-message"]', { timeout: 90_000 });
  const verdictMessage = await page.locator('[data-testid="detail-message"]').innerText();
  check("job 2: a verdict was recorded and sealed", /disputed/i.test(verdictMessage), verdictMessage.slice(0, 90));

  await page.locator('[data-testid="reassay"]').click();
  await page.waitForTimeout(9_000);
  const reassayMessage = await page.locator('[data-testid="detail-message"]').innerText();
  check("job 2: re-assay against live data succeeded", /re-assayed/i.test(reassayMessage), reassayMessage.slice(0, 110));

  // Chain tab.
  await page.getByRole("tab", { name: /chain/i }).click();
  await page.waitForSelector('[data-testid="replay-result"]', { timeout: 90_000 });
  const replayText = await page.locator('[data-testid="replay-result"]').innerText();
  check("job 2: integrity replay reports no broken link", /verified/i.test(replayText), replayText.slice(0, 110));

  await page.screenshot({ path: `${SHOTS}/04-audit-chain.png`, fullPage: false });

  /* Job 3: the agent console mutates through the same path. */
  await page.goto(`${BASE}/agent`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(4_000);

  const initializeLogged = await page.locator("text=/initialize/i").count();
  check("job 3: the console ran initialize on load", initializeLogged > 0);

  const toolsResponse = await page.locator('[data-testid="agent-response"]').first().innerText();
  check("job 3: tools/list returned the real tool list", toolsResponse.includes("assay_mint") && toolsResponse.includes("register_origin"));

  await page.locator('[data-testid="tool-register_origin"]').click();
  await page.waitForSelector("text=/active origin:/i", { timeout: 150_000 });

  const agentOriginId = (await page.locator("text=/active origin:/i").innerText())
    .replace(/active origin:\s*/i, "")
    .trim();
  // The console supplies an idempotency key, so the id is deliberately
  // `idem_`-prefixed rather than a random `o_` id.
  check(
    "job 3: the agent created a record and reported its id",
    /^(o|idem)_[a-z0-9]{6,}$/i.test(agentOriginId),
    agentOriginId,
  );

  const agentError = await page.locator('[data-testid="agent-response"]').filter({ hasText: '"error"' }).count();
  check("job 3: the agent call produced no JSON-RPC error", agentError === 0);

  await page.screenshot({ path: `${SHOTS}/05-agent-console.png`, fullPage: false });

  /* Repository access in shared navigation. */
  const headerRepo = page.locator('header a[href*="github.com/aniruddhaadak80/mintline"]');
  check("GitHub: a repository link sits in the shared navigation", (await headerRepo.count()) > 0);

  const href = await headerRepo.first().getAttribute("href");
  const target = await headerRepo.first().getAttribute("target");
  const rel = await headerRepo.first().getAttribute("rel");
  const label = (await headerRepo.first().innerText()).trim();
  check("GitHub: the navigation link points at the public repository", href === "https://github.com/aniruddhaadak80/mintline", href ?? "missing");
  check("GitHub: the link opens safely in a new tab", target === "_blank" && (rel ?? "").includes("noopener"), `target=${target} rel=${rel}`);
  check("GitHub: the link has visible text", label.length > 0, label);

  // The destination itself is verified over HTTP by scripts/verify-live.mjs,
  // so this pass does not navigate off-site.

  /* Keyboard navigation and visible focus. */
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName ?? "none");
  check("a11y: Tab moves focus into the page", focusedTag !== "none" && focusedTag !== "BODY");

  const outline = await page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return null;
    const style = getComputedStyle(element);
    return { width: style.outlineWidth, style: style.outlineStyle };
  });
  check(
    "a11y: the focused element has a visible outline",
    Boolean(outline && outline.style !== "none" && parseFloat(outline.width) > 0),
    JSON.stringify(outline),
  );

  const skipLink = await page.locator('a[href="#main"]').count();
  check("a11y: a skip-to-content link is present", skipLink > 0);

  const landmarks = await page.evaluate(() => ({
    header: document.querySelectorAll("header").length,
    main: document.querySelectorAll("main").length,
    footer: document.querySelectorAll("footer").length,
    nav: document.querySelectorAll("nav").length,
  }));
  check(
    "a11y: semantic landmarks are present",
    landmarks.header >= 1 && landmarks.main === 1 && landmarks.footer >= 1 && landmarks.nav >= 1,
    JSON.stringify(landmarks),
  );

  const h1 = await page.locator("h1").count();
  check("a11y: exactly one h1 on the landing page", h1 === 1, `${h1} h1 elements`);

  /* Export. */
  await page.goto(`${BASE}/export`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const download = page.waitForEvent("download", { timeout: 90_000 });
  await page.locator('[data-testid="dossier-download-md"]').click();
  const file = await download;
  check("export: a real dossier file downloads", (await file.suggestedFilename()).endsWith(".md"), await file.suggestedFilename());

  const dossier = await page.locator('[data-testid="dossier-preview"]').count();
  void dossier;
  await page.getByRole("button", { name: /preview/i }).click();
  await page.waitForSelector('[data-testid="dossier-preview"]', { timeout: 90_000 });
  const preview = await page.locator('[data-testid="dossier-preview"]').innerText();
  check("export: the dossier preview shows the factor table", preview.includes("Factor breakdown"));

  await page.screenshot({ path: `${SHOTS}/06-export-dossier.png`, fullPage: false });

  /* Settings + chain overview screenshots. */
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const adapterText = await page.locator('[data-testid="store-adapter"]').innerText();
  check("settings: the page reports the live storage adapter", adapterText === "neon", adapterText);
  await page.screenshot({ path: `${SHOTS}/07-settings.png`, fullPage: false });

  await page.goto(`${BASE}/chain`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  check("chain: the overview page renders", (await page.locator("text=/chains replayed/i").count()) > 0);
  await page.screenshot({ path: `${SHOTS}/08-chain-overview.png`, fullPage: false });

  await page.goto(`${BASE}/assay`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const serverComparator = await page.locator("text=/always available/i").count();
  const browserComparator = await page.locator("text=/on demand/i").count();
  check(
    "assay: the lab documents both comparators",
    serverComparator > 0 && browserComparator > 0,
    `server=${serverComparator} browser=${browserComparator}`,
  );
  await page.screenshot({ path: `${SHOTS}/09-assay-lab.png`, fullPage: false });

  await context.close();
}

/* ------------------------------------------------------------------ *
 * Mobile
 * ------------------------------------------------------------------ */
{
  const { context, page } = await newPage({ width: 390, height: 844 });

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.screenshot({ path: `${SHOTS}/10-mobile-landing.png`, fullPage: false });

  // The mobile menu is a client component, so wait for hydration before
  // clicking rather than depending on load timing.
  const menuButton = page.getByRole("button", { name: /open menu/i });
  await menuButton.waitFor({ state: "attached", timeout: 60_000 });
  check("mobile: a menu button is exposed", (await menuButton.count()) > 0);

  let menuOpened = false;
  for (let attempt = 0; attempt < 3 && !menuOpened; attempt += 1) {
    await menuButton.click({ timeout: 30_000 }).catch(() => undefined);
    menuOpened = (await page.locator("#mobile-nav").count()) > 0;
    if (!menuOpened) await page.waitForTimeout(1_500);
  }
  check("mobile: the menu opens", menuOpened);

  const mobileLinks = await page.locator("#mobile-nav a").count();
  check("mobile: the menu opens with links", mobileLinks >= 5, `${mobileLinks} links`);

  const mobileRepo = await page.locator('#mobile-nav a[href*="github.com/aniruddhaadak80/mintline"]').count();
  check("mobile: the repository link is in the mobile menu", mobileRepo > 0);

  await page.screenshot({ path: `${SHOTS}/11-mobile-menu.png`, fullPage: false });

  // Escape must close it.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("mobile: Escape closes the menu", (await page.locator("#mobile-nav").count()) === 0);

  await page.goto(`${BASE}/registry`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.screenshot({ path: `${SHOTS}/12-mobile-registry.png`, fullPage: false });

  // No horizontal overflow at 390px.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("mobile: no horizontal overflow", overflow <= 1, `${overflow}px overflow`);

  await context.close();
}

/* ------------------------------------------------------------------ *
 * Diagnostics
 * ------------------------------------------------------------------ */
console.log("");
check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
check("no failed network requests", failedRequests.length === 0, failedRequests.slice(0, 3).join(" | "));

await browser.close();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log(`\nScreenshots written to ${SHOTS}/\n`);
