/**
 * Dossier export.
 *
 * The takeaway artifact: a file a visitor can send to a launchpad, paste into a
 * group chat, or attach to a ticket. It has to stand on its own without this
 * app running, so it carries the evidence, the factor breakdown, the source
 * attribution with fetch timestamps, and the seal chain head.
 *
 * Two formats: Markdown for humans, JSON for machines. Both are generated from
 * the same object, so they can never disagree.
 */

import { replayChain } from "../integrity/chain";
import { ENGINE_VERSION, type AssayResult, type ChainEvent, type MintFacts, type OriginRecord, type SourceAttribution } from "../types";
import { SITE } from "../config";

export interface Dossier {
  schema: "mintline.dossier/1";
  generatedAt: string;
  subject: {
    id: string;
    mint: string;
    name: string;
    symbol: string | null;
    description: string | null;
    claimedAt: string;
    status: string;
  };
  assay: AssayResult | null;
  liveFacts: {
    fetchedAt: string | null;
    liquidityUsd: number | null;
    volume24h: number | null;
    priceUsd: number | null;
    ageDays: number | null;
    pairCount: number;
    dexCount: number;
    holderConcentration: MintFacts["holders"];
    priceCorroboration: MintFacts["corroboration"];
  } | null;
  integrity: {
    genesis: string;
    headSeal: string;
    eventCount: number;
    verified: boolean;
    brokenAtSeq: number | null;
    events: Array<{ seq: number; eventType: string; seal: string; createdAt: string }>;
  };
  sources: SourceAttribution[];
  provenance: {
    generator: string;
    engineVersion: typeof ENGINE_VERSION;
    repository: string;
  };
  disclaimer: string;
}

export const SAFETY_DISCLAIMER =
  "Mintline measures observable structure: name collisions, metadata completeness, market depth, holder concentration and trading age. " +
  "It does not predict price, does not evaluate whether a token is a good investment, and is not financial advice. " +
  "A high provenance score means an identity is not obviously impersonating another; it is not an endorsement of the project behind it. " +
  "Verify anything that matters against the issuer directly.";

export function buildDossier(
  origin: OriginRecord,
  facts: MintFacts | null,
  events: ChainEvent[],
): Dossier {
  const replay = replayChain(origin.id, events);

  const liveFacts: Dossier["liveFacts"] = facts
    ? {
        fetchedAt: facts.sources[0]?.fetchedAt ?? null,
        liquidityUsd: Number.isFinite(facts.liquidityUsd) ? facts.liquidityUsd : null,
        volume24h: Number.isFinite(facts.volume24h) ? facts.volume24h : null,
        priceUsd: facts.priceUsd,
        ageDays: facts.ageDays,
        pairCount: facts.pairCount,
        dexCount: facts.dexCount,
        holderConcentration: facts.holders,
        priceCorroboration: facts.corroboration,
      }
    : null;

  return {
    schema: "mintline.dossier/1",
    generatedAt: new Date().toISOString(),
    subject: {
      id: origin.id,
      mint: origin.mint,
      name: origin.name,
      symbol: origin.symbol,
      description: origin.description,
      claimedAt: origin.claimedAt,
      status: origin.status,
    },
    assay: origin.assay,
    liveFacts,
    integrity: {
      genesis: replay.genesis,
      headSeal: replay.headSeal ?? origin.chainHead,
      eventCount: events.length,
      verified: replay.ok,
      brokenAtSeq: replay.brokenAtSeq,
      events: events.map((event) => ({
        seq: event.seq,
        eventType: event.eventType,
        seal: event.seal,
        createdAt: event.createdAt,
      })),
    },
    sources: facts?.sources ?? [],
    provenance: {
      generator: `${SITE.name} ${ENGINE_VERSION}`,
      engineVersion: ENGINE_VERSION,
      repository: SITE.repositoryUrl,
    },
    disclaimer: SAFETY_DISCLAIMER,
  };
}

function usd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "unavailable";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

export function dossierToMarkdown(dossier: Dossier): string {
  const lines: string[] = [];
  const { subject, assay, liveFacts, integrity } = dossier;

  lines.push(`# Origin dossier — ${subject.name}`);
  lines.push("");
  lines.push(
    assay
      ? `**Provenance integrity ${assay.score.toFixed(2)} / 100 — ${assay.verdict.replace(/_/g, " ")}**`
      : "**No assay has been recorded for this origin.**",
  );
  lines.push("");
  lines.push(`- **Mint:** \`${subject.mint}\``);
  if (subject.symbol) lines.push(`- **Ticker:** \`${subject.symbol}\``);
  lines.push(`- **Status:** ${subject.status}`);
  lines.push(`- **Claimed:** ${subject.claimedAt}`);
  lines.push(`- **Record:** ${SITE.liveUrl}/registry/${subject.id}`);
  lines.push(`- **Engine:** \`${dossier.provenance.engineVersion}\``);
  lines.push(`- **Generated:** ${dossier.generatedAt}`);
  lines.push("");

  if (subject.description) {
    lines.push("## Identity text as registered");
    lines.push("");
    lines.push(`> ${subject.description.replace(/\n/g, "\n> ")}`);
    lines.push("");
  }

  if (assay) {
    lines.push("## Factor breakdown");
    lines.push("");
    lines.push("| Factor | Weight | Value | Points | Evidence |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const factor of assay.factors) {
      const evidence = factor.evidence.replace(/\|/g, "\\|");
      lines.push(
        `| ${factor.label} | ${factor.weight.toFixed(2)} | ${factor.value.toFixed(4)} | ${factor.points.toFixed(2)} | ${evidence} |`,
      );
    }
    lines.push("");
    lines.push(`Total: **${assay.score.toFixed(2)}** / 100.`);
    if (assay.degraded) {
      lines.push("");
      lines.push(
        "> This score is **partial**: at least one factor could not be measured and contributed zero. See the Availability column in the API response.",
      );
    }
    lines.push("");
    lines.push("**Recommended action.** " + assay.recommendation);
    lines.push("");

    if (assay.neighbors.length > 0) {
      lines.push("### Closest registered identities");
      lines.push("");
      for (const neighbor of assay.neighbors) {
        const terms = neighbor.sharedTerms.length > 0 ? ` — shared: ${neighbor.sharedTerms.join(", ")}` : "";
        lines.push(
          `- **${neighbor.name}**${neighbor.symbol ? ` (\`${neighbor.symbol}\`)` : ""} — similarity ${neighbor.similarity.toFixed(4)}${neighbor.registered ? "" : " [reference]"}${terms}`,
        );
      }
      lines.push("");
    }
  }

  if (liveFacts) {
    lines.push("## Live chain facts");
    lines.push("");
    lines.push(`- **Liquidity:** ${usd(liveFacts.liquidityUsd)}`);
    lines.push(`- **24h volume:** ${usd(liveFacts.volume24h)}`);
    lines.push(`- **Price:** ${usd(liveFacts.priceUsd)}`);
    lines.push(`- **Trading age:** ${liveFacts.ageDays === null ? "unavailable" : `${liveFacts.ageDays.toFixed(1)} days`}`);
    lines.push(`- **Venues:** ${liveFacts.pairCount} pair(s) across ${liveFacts.dexCount} venue(s)`);
    lines.push(
      `- **Holder concentration:** ${
        liveFacts.holderConcentration.state === "ok"
          ? `top ${liveFacts.holderConcentration.accountsInspected} hold ${((liveFacts.holderConcentration.topShare ?? 0) * 100).toFixed(1)}%`
          : `unavailable — ${liveFacts.holderConcentration.reason ?? "no reading"}`
      }`,
    );
    if (liveFacts.priceCorroboration.priceUsd !== null) {
      lines.push(
        `- **Price corroboration:** ${usd(liveFacts.priceCorroboration.priceUsd)} from ${liveFacts.priceCorroboration.source}, divergence ${
          liveFacts.priceCorroboration.divergence === null
            ? "unavailable"
            : `${(liveFacts.priceCorroboration.divergence * 100).toFixed(3)}%`
        }`,
      );
    }
    lines.push("");
  }

  lines.push("## Integrity chain");
  lines.push("");
  lines.push(`- **Genesis:** \`${integrity.genesis}\``);
  lines.push(`- **Head seal:** \`${integrity.headSeal}\``);
  lines.push(`- **Events:** ${integrity.eventCount}`);
  lines.push(`- **Replay:** ${integrity.verified ? "verified, no broken link" : `BROKEN at seq ${integrity.brokenAtSeq}`}`);
  lines.push("");
  lines.push("Seal rule: `seal(n) = SHA-384(UTF-8(seal(n-1)) || canonicalJson(event(n)))`.");
  lines.push("");
  lines.push("| Seq | Event | Seal | Recorded |");
  lines.push("| --- | --- | --- | --- |");
  for (const event of integrity.events) {
    lines.push(`| ${event.seq} | ${event.eventType} | \`${event.seal.slice(0, 16)}…\` | ${event.createdAt} |`);
  }
  lines.push("");

  lines.push("## Sources");
  lines.push("");
  if (dossier.sources.length === 0) {
    lines.push("_No live sources were consulted for this export._");
  } else {
    lines.push("| Source | Status | Fetched | Note |");
    lines.push("| --- | --- | --- | --- |");
    for (const source of dossier.sources) {
      lines.push(
        `| [${source.label}](${source.homepage}) | ${source.status} | ${source.fetchedAt} | ${(source.note ?? "—").replace(/\|/g, "\\|")} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Disclaimer");
  lines.push("");
  lines.push(dossier.disclaimer);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`Generated by [${SITE.name}](${SITE.liveUrl}) · [source](${SITE.repositoryUrl})`);

  return lines.join("\n");
}