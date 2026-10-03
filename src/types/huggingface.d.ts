/**
 * Ambient module declarations.
 *
 * `@huggingface/transformers` ships its own runtime but resolves to an
 * untyped entry point under `moduleResolution: bundler`. Only the surface this
 * project actually uses is declared, so a wrong call is still a type error.
 */

declare module "@huggingface/transformers" {
  export interface FeatureExtractionOutput {
    data: Float32Array;
    dims: number[];
  }

  export type FeatureExtractionPipeline = (
    texts: string[],
    options: { pooling: "mean"; normalize: boolean },
  ) => Promise<FeatureExtractionOutput>;

  export interface TransformersEnv {
    allowLocalModels: boolean;
    useBrowserCache: boolean;
  }

  export const env: TransformersEnv;

  export function pipeline(
    task: "feature-extraction",
    model: string,
    options?: {
      dtype?: string;
      progress_callback?: (item: unknown) => void;
    },
  ): Promise<FeatureExtractionPipeline>;
}