/**
 * Shared embedder singleton — loaded once, shared across the application.
 */
import { pipeline } from "@xenova/transformers";
import { getConfig } from "./config.js";

let embedder: any = null;

export async function getEmbedder(): Promise<any> {
  const cfg = getConfig();
  if (!embedder) {
    embedder = await pipeline("feature-extraction", cfg.embedderModel);
  }
  return embedder;
}
