/**
 * Shared embedder — singleton pipeline(s) for feature extraction.
 * Supports multiple concurrent ONNX sessions for parallel embedding.
 */
import { pipeline } from "@xenova/transformers";
import { getConfig } from "./config.js";

const embedders: any[] = [];

export async function getEmbedder(): Promise<any> {
  if (embedders.length === 0) {
    const cfg = getConfig();
    embedders.push(await pipeline("feature-extraction", cfg.embedderModel));
  }
  return embedders[0];
}

export async function getEmbedders(): Promise<any[]> {
  const cfg = getConfig();
  while (embedders.length < cfg.embeddingConcurrency) {
    embedders.push(await pipeline("feature-extraction", cfg.embedderModel));
  }
  return embedders;
}
