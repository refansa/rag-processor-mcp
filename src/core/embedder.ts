/**
 * Shared embedder — returns EmbeddingProvider instances.
 */
import { OpenAIEmbeddings } from "@langchain/openai";
import type { Embeddings } from "@langchain/core/embeddings";
import type { CohereEmbeddings } from "@langchain/cohere";
import { LCEmbeddingProvider } from "./embed/langchain-provider.js";
import { LocalProvider } from "./embed/local-provider.js";
import type { EmbeddingProvider } from "./embed/provider.js";
import { getConfig } from "./config.js";

async function createLC(
  provider: string,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<Embeddings> {
  switch (provider) {
    case "openai": {
      return new OpenAIEmbeddings({
        apiKey,
        model,
        configuration: { baseURL: baseUrl || undefined },
      });
    }
    case "cohere": {
      // Dynamic import to avoid pulling in @langchain/cohere's heavy deps when unused.
      const { CohereEmbeddings: CohereCls } = (await import("@langchain/cohere")) as {
        CohereEmbeddings: typeof CohereEmbeddings;
      };
      return new CohereCls({ apiKey, model });
    }
    default: {
      throw new Error(`Unknown embed provider: ${provider}`);
    }
  }
}

interface CachedConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  concurrency: number;
}

let instances: EmbeddingProvider[] = [];
let cachedConfig: CachedConfig | null = null;

function configChanged(cfg: CachedConfig): boolean {
  return (
    !cachedConfig ||
    cachedConfig.provider !== cfg.provider ||
    cachedConfig.model !== cfg.model ||
    cachedConfig.apiKey !== cfg.apiKey ||
    cachedConfig.baseUrl !== cfg.baseUrl ||
    cachedConfig.concurrency !== cfg.concurrency
  );
}

export async function resetEmbedders(): Promise<void> {
  for (const inst of instances) {
    await inst.dispose();
  }
  instances = [];
  cachedConfig = null;
}

export async function getEmbedder(): Promise<EmbeddingProvider> {
  const providers = await getEmbedders();
  return providers[0];
}

export async function getEmbedders(): Promise<EmbeddingProvider[]> {
  const cfg = getConfig();

  if (configChanged(cfg.embedder)) {
    await resetEmbedders();
    cachedConfig = { ...cfg.embedder };
  }

  while (instances.length < cachedConfig!.concurrency) {
    if (cachedConfig!.provider === "local") {
      instances.push(await LocalProvider.create(cachedConfig!.model));
    } else {
      const lc = await createLC(
        cachedConfig!.provider,
        cachedConfig!.model,
        cachedConfig!.apiKey,
        cachedConfig!.baseUrl,
      );
      instances.push(new LCEmbeddingProvider(lc));
    }
  }

  return instances;
}
