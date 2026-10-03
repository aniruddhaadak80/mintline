"use client";

/**
 * On-device semantic collision detection.
 *
 * This is the open-weight half of the product. A sentence-embedding model runs
 * in the visitor's browser via transformers.js (ONNX Runtime Web), so:
 *
 *  - the identity text is never sent to an inference server;
 *  - it keeps working after the first load with no network at all;
 *  - nothing about the run costs money, because no GPU is rented.
 *
 * The model is imported dynamically inside an event handler, so it is never in
 * the initial bundle and never evaluated on the server. If it fails to load, the
 * caller keeps the server's deterministic lexical reading and the UI says which
 * one produced the number.
 *
 * Model: `Xenova/all-MiniLM-L6-v2` (Apache-2.0), 22M parameters, quantized to
 * int8 — roughly 23 MB fetched once and then cached by the browser.
 */

import { cosineDense } from "@/lib/engine/similarity";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  EMBEDDING_REPO,
} from "@/lib/engine/model-info";
import type { NeighborMatch, SimilarityResult } from "@/lib/types";

export { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID };

export interface CorpusVector {
  originId: string | null;
  name: string;
  symbol: string | null;
  mint: string | null;
  text: string;
  registered: boolean;
}

export type EmbeddingState =
  | { status: "idle" }
  | { status: "loading"; detail: string }
  | { status: "ready"; model: string }
  | { status: "error"; message: string };

type Extractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

let extractorPromise: Promise<Extractor> | null = null;

/** Load the pipeline once per page session. */
async function getExtractor(onProgress?: (detail: string) => void): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      onProgress?.("Fetching the open-weight model (cached after first load)");
      const transformers = await import("@huggingface/transformers");
      transformers.env.allowLocalModels = false;
      transformers.env.useBrowserCache = true;

      const pipe = (await transformers.pipeline("feature-extraction", EMBEDDING_REPO, {
        dtype: "q8",
        progress_callback: (item: unknown) => {
          const record = item as { status?: string; file?: string; progress?: number };
          if (record.status === "progress" && typeof record.progress === "number") {
            onProgress?.(`Downloading ${record.file ?? "model"} — ${Math.round(record.progress)}%`);
          }
        },
      })) as unknown as Extractor;

      return pipe;
    })().catch((error) => {
      extractorPromise = null;
      throw error;
    });
  }
  return extractorPromise;
}

/** Embed a batch of texts. Returns one Float32Array per input, in order. */
export async function embedTexts(
  texts: string[],
  onProgress?: (detail: string) => void,
): Promise<Float32Array[]> {
  const extract = await getExtractor(onProgress);
  const output = await extract(texts, { pooling: "mean", normalize: true });
  const data = output.data;
  const dims = output.dims;
  const width = dims[dims.length - 1];
  const count = dims[0] ?? texts.length;

  const vectors: Float32Array[] = [];
  for (let i = 0; i < count; i += 1) {
    vectors.push(data.slice(i * width, (i + 1) * width));
  }
  return vectors;
}

/** Content words two texts share, used to explain a match in plain words. */
function sharedTerms(a: string, b: string): string[] {
  const tokenize = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2),
    );
  const left = tokenize(a);
  const right = tokenize(b);
  return [...left].filter((t) => right.has(t)).sort().slice(0, 8);
}

/**
 * Semantic similarity of `identityText` against a corpus, computed on-device.
 *
 * The output shape is identical to `lexicalSimilarity`, so the engine cannot
 * tell which one produced it except by reading `method` — which is exactly the
 * point: one engine, two honest comparators.
 */
export async function neuralSimilarity(
  identityText: string,
  corpus: CorpusVector[],
  options: { threshold?: number; limit?: number; onProgress?: (detail: string) => void } = {},
): Promise<SimilarityResult> {
  const threshold = options.threshold ?? 0.12;
  const limit = options.limit ?? 6;

  if (corpus.length === 0) {
    return {
      method: "neural",
      model: EMBEDDING_MODEL_ID,
      top: 0,
      neighbors: [],
      degraded: false,
    };
  }

  const texts = [identityText, ...corpus.map((entry) => entry.text)];
  const vectors = await embedTexts(texts, options.onProgress);
  const target = vectors[0];

  const neighbors: NeighborMatch[] = [];

  for (let i = 0; i < corpus.length; i += 1) {
    const entry = corpus[i];
    const similarity = cosineDense(target, vectors[i + 1]);
    if (similarity < threshold) continue;

    neighbors.push({
      originId: entry.originId,
      name: entry.name || entry.symbol || "unnamed",
      symbol: entry.symbol,
      mint: entry.mint,
      similarity: Math.round(Math.min(1, Math.max(0, similarity)) * 10000) / 10000,
      sharedTerms: sharedTerms(identityText, entry.text),
      registered: entry.registered,
    });
  }

  neighbors.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  return {
    method: "neural",
    model: EMBEDDING_MODEL_ID,
    top: neighbors.length > 0 ? neighbors[0].similarity : 0,
    neighbors: neighbors.slice(0, limit),
    degraded: false,
  };
}

/** True once the model is cached, so the UI can promise offline use. */
export async function isModelCached(): Promise<boolean> {
  try {
    if (typeof caches === "undefined") return false;
    const keys = await caches.keys();
    return keys.some((key) => key.toLowerCase().includes("huggingface") || key.toLowerCase().includes("transformers"));
  } catch {
    return false;
  }
}