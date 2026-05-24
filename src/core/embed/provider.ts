export interface EmbeddingProvider {
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
  dispose(): void | Promise<void>;
}
