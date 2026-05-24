import type { Embeddings } from "@langchain/core/embeddings";
import type { EmbeddingProvider } from "./provider.js";

export class LCEmbeddingProvider implements EmbeddingProvider {
  private lc: Embeddings;

  constructor(lc: Embeddings) {
    this.lc = lc;
  }

  async embed(texts: string[], _signal?: AbortSignal): Promise<number[][]> {
    return this.lc.embedDocuments(texts);
  }

  dispose(): void {
    this.lc = null!;
  }
}
