/**
 * Local ONNX embedder using @xenova/transformers.
 */
import { pipeline } from "@xenova/transformers";
import type { EmbeddingProvider } from "./provider.js";

export class LocalProvider implements EmbeddingProvider {
  private p: any;

  constructor(localPipeline: any) {
    this.p = localPipeline;
  }

  static async create(model: string): Promise<LocalProvider> {
    const localPipeline = await pipeline("feature-extraction", model);
    return new LocalProvider(localPipeline);
  }

  async embed(texts: string[], _signal?: AbortSignal): Promise<number[][]> {
    const output = await this.p(texts, { normalize: true, pooling: "mean" });
    return output.tolist();
  }
}
