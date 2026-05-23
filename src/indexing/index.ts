import type { Chunk, StoreEntry } from "../core/types.js";
import { getEmbedder } from "../core/embedder.js";
import type { Store } from "../core/store/index.js";
import { resolveRepo } from "./resolver.js";
import { scanFiles } from "./scanner.js";
import { chunkFile } from "./chunker.js";
import { getConfig } from "../core/config.js";

const cfg = getConfig();
const BATCH_SIZE = cfg.embeddingBatchSize;

export interface IndexProgress {
  phase: "clone" | "scan" | "chunk" | "embed" | "store";
  current: number;
  total: number;
  message: string;
}

export async function indexRepo(
  repoRef: string,
  store: Store,
  opts?: {
    signal?: AbortSignal;
    onProgress?: (p: IndexProgress) => void;
  },
): Promise<{ repoName: string; fileCount: number; chunkCount: number }> {
  const signal = opts?.signal;
  const onProgress = opts?.onProgress;

  function progress(
    phase: IndexProgress["phase"],
    current: number,
    total: number,
    message: string,
  ) {
    onProgress?.({ current, message, phase, total });
  }

  if (signal?.aborted) {
    throw new Error("Indexing cancelled");
  }

  progress("clone", 0, 1, `Resolving repo: ${repoRef}`);
  console.error(`[indexer] Resolving repo: ${repoRef}`);
  const { localPath, repoName } = await resolveRepo(repoRef);

  if (signal?.aborted) {
    throw new Error("Indexing cancelled");
  }
  progress("scan", 0, 1, `Scanning files in ${localPath}...`);
  console.error(`[indexer] Scanning files in ${localPath}...`);
  const files = scanFiles(localPath);
  console.error(`[indexer] Found ${files.length} files`);

  if (signal?.aborted) {
    throw new Error("Indexing cancelled");
  }
  progress("chunk", 0, files.length, `Chunking ${files.length} files...`);
  console.error(`[indexer] Chunking...`);
  const chunks: Chunk[] = [];
  for (let fi = 0; fi < files.length; fi++) {
    chunks.push(...chunkFile(files[fi], repoName));
    progress("chunk", fi + 1, files.length, `Chunking: ${fi + 1}/${files.length} files`);
  }
  console.error(`[indexer] Created ${chunks.length} chunks`);

  if (signal?.aborted) {
    throw new Error("Indexing cancelled");
  }
  progress("embed", 0, chunks.length, `Embedding ${chunks.length} chunks...`);
  console.error(`[indexer] Generating embeddings (${chunks.length} chunks)...`);
  const embedder = await getEmbedder();

  const storeEntries: StoreEntry[] = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    if (signal?.aborted) {
      throw new Error("Indexing cancelled");
    }

    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.text);

    const output = await embedder(texts, { normalize: true, pooling: "mean" });
    const embeddings: number[][] = output.tolist();

    for (let j = 0; j < batch.length; j++) {
      storeEntries.push({
        embedding: embeddings[j],
        id: batch[j].id,
        metadata: batch[j].metadata,
        text: batch[j].text,
      });
    }

    const done = Math.min(i + BATCH_SIZE, chunks.length);
    progress("embed", done, chunks.length, `Embedding: ${done}/${chunks.length} chunks`);

    if ((i + BATCH_SIZE) % 200 === 0 || i + BATCH_SIZE >= chunks.length) {
      console.error(`[indexer] ... ${done}/${chunks.length} chunks embedded`);
    }
  }

  if (signal?.aborted) {
    throw new Error("Indexing cancelled");
  }

  // Save repo metadata first so FK constraint is satisfied, then overwrite entries
  progress("store", 0, storeEntries.length, `Storing ${storeEntries.length} entries...`);
  console.error(`[indexer] Storing ${storeEntries.length} entries...`);

  await store.repo.save({
    chunkCount: storeEntries.length,
    indexedAt: new Date().toISOString(),
    repoName,
    repoUrl: repoRef,
  });

  await store.entry.overwriteRepoEntries(repoName, storeEntries);

  const total = await store.entry.totalEntries();
  console.error(`[indexer] Done. Total vector store: ${total} entries`);

  progress("store", storeEntries.length, storeEntries.length, "Done");

  return { chunkCount: storeEntries.length, fileCount: files.length, repoName };
}
