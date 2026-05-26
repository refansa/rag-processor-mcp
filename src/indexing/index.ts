import type { Chunk, StoreEntry } from "../core/types.js";
import { getEmbedders, resetEmbedders } from "../core/embedder.js";
import type { Store } from "../core/store/index.js";
import { AbortError } from "../core/abort-error.js";
import { resolveRepo } from "./resolver.js";
import { scanFiles } from "./scanner.js";
import { chunkFile, countChunks } from "./chunker.js";
import { getConfig } from "../core/config.js";
import simpleGitModule from "simple-git";

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
    branch?: string;
  },
): Promise<{ repoName: string; fileCount: number; chunkCount: number }> {
  const signal = opts?.signal;
  const onProgress = opts?.onProgress;
  const branch = opts?.branch;

  function progress(
    phase: IndexProgress["phase"],
    current: number,
    total: number,
    message: string,
  ) {
    onProgress?.({ current, message, phase, total });
  }

  progress("clone", 0, 1, `Resolving repo: ${repoRef}`);
  console.error(`[indexer] Resolving repo: ${repoRef}`);
  const { localPath, repoName, newCommitHash } = await resolveRepo(repoRef, signal, branch);

  const repos = await store.repo.listAll();
  const existingRepo = repos.find((r) => r.repoName === repoName);
  const previousCommitHash = existingRepo?.commitHash;

  if (previousCommitHash && newCommitHash && previousCommitHash === newCommitHash) {
    console.error(`[indexer] Repo ${repoName} is already up to date at commit ${newCommitHash}`);
    progress("store", 1, 1, "Done (up to date)");

    const chunkCount = await store.entry.countRepoEntries(repoName);
    const repoFiles = await store.entry.getRepoFiles(repoName);
    return {
      chunkCount,
      fileCount: repoFiles.length,
      repoName,
    };
  }

  let isIncremental = false;
  const deletedPaths: string[] = [];
  const addedOrModifiedPaths: string[] = [];

  if (previousCommitHash && newCommitHash) {
    console.error(`[indexer] Computing diff from ${previousCommitHash} to ${newCommitHash}...`);
    try {
      const git = simpleGitModule({ baseDir: localPath });
      const rawDiff = await git.raw(["diff", "--name-status", previousCommitHash, newCommitHash]);
      const lines = rawDiff.split("\n").filter(Boolean);
      for (const line of lines) {
        const parts = line.split(/\t+/);
        if (parts.length < 2) {
          continue;
        }
        const status = parts[0];
        if (status.startsWith("D")) {
          deletedPaths.push(parts[1]);
        } else if (status.startsWith("A") || status.startsWith("M")) {
          addedOrModifiedPaths.push(parts[1]);
        } else if (status.startsWith("R")) {
          deletedPaths.push(parts[1]);
          addedOrModifiedPaths.push(parts[2]);
        }
      }
      isIncremental = true;
      console.error(
        `[indexer] Incremental diff: ${deletedPaths.length} deleted, ${addedOrModifiedPaths.length} added/modified`,
      );
    } catch (err) {
      console.error(`[indexer] Failed to compute diff, falling back to full index`, err);
      isIncremental = false;
    }
  }

  if (signal?.aborted) {
    throw new AbortError("Cancelled before scanning");
  }
  progress("scan", 0, 1, `Scanning files in ${localPath}...`);
  console.error(`[indexer] Scanning files in ${localPath}...`);
  let files = scanFiles(localPath);

  if (isIncremental) {
    const targetSet = new Set(addedOrModifiedPaths);
    // Relative path matching for scanFiles result. scanFiles returns { path, ... }
    // which is relative to localPath.
    files = files.filter((f) => targetSet.has(f.path.replace(/\\/g, "/")));

    if (deletedPaths.length > 0 || addedOrModifiedPaths.length > 0) {
      const toRemove = [...deletedPaths, ...addedOrModifiedPaths];
      console.error(`[indexer] Removing ${toRemove.length} files from store before chunking...`);
      await store.entry.removeFileEntries(repoName, toRemove);
    }
  }

  console.error(`[indexer] Found ${files.length} files to chunk`);
  // Compute exact total chunk count for accurate progress reporting
  let totalChunkCount = 0;
  for (const file of files) {
    totalChunkCount += countChunks(file);
  }
  console.error(`[indexer] Will produce ${totalChunkCount} chunks`);

  if (signal?.aborted) {
    throw new AbortError("Cancelled before chunking");
  }
  progress("chunk", 0, files.length, `Chunking ${files.length} files...`);
  console.error(`[indexer] Chunking...`);

  const embedders = await getEmbedders();

  try {
    const storeEntries: StoreEntry[] = [];

    // ── Producer-consumer pipeline ──────────────────────────────────────
    // Producer: chunk files and push to shared buffer
    // Consumer: pull from buffer and embed batches
    // Both run concurrently via Promise.all for real overlap.

    const chunkBuffer: Chunk[] = [];
    let producerDone = false;
    let resolveAvailable: (() => void) | null = null;
    function notify() {
      resolveAvailable?.();
      resolveAvailable = null;
    }

    async function waitForChunks(): Promise<Chunk[] | null> {
      while (true) {
        if (chunkBuffer.length > 0) {
          return chunkBuffer.splice(0, BATCH_SIZE);
        }
        if (producerDone) {
          return null;
        }
        if (signal?.aborted) {
          throw new AbortError("Cancelled while waiting for chunks");
        }
        await new Promise<void>((r) => {
          resolveAvailable = r;
        });
      }
    }

    const producer = (async () => {
      try {
        for (let fi = 0; fi < files.length; fi++) {
          if (signal?.aborted) {
            throw new AbortError("Cancelled during chunking");
          }
          const fileChunks = chunkFile(files[fi], repoName);
          chunkBuffer.push(...fileChunks);
          notify();
          progress("chunk", fi + 1, files.length, `Chunking: ${fi + 1}/${files.length} files`);
        }
      } finally {
        producerDone = true;
        notify();
      }
    })();

    const consumer = (async () => {
      let embeddedCount = 0;
      const MAX_IN_FLIGHT = embedders.length;
      const pending: { chunks: Chunk[]; embeddings: Promise<number[][]> }[] = [];
      let ei = 0;

      while (true) {
        if (signal?.aborted) {
          throw new AbortError("Cancelled during embedding");
        }

        const batch = await waitForChunks();
        if (batch === null) {
          break;
        }

        // Wait if at capacity to keep max in-flight batches
        if (pending.length >= MAX_IN_FLIGHT) {
          const done = await pending.shift()!;
          const embeddings = await done.embeddings;
          for (let j = 0; j < done.chunks.length; j++) {
            storeEntries.push({
              embedding: embeddings[j],
              id: done.chunks[j].id,
              metadata: done.chunks[j].metadata,
              text: done.chunks[j].text,
            });
          }
          embeddedCount += done.chunks.length;
          progress("embed", embeddedCount, totalChunkCount, `Embedding: ${embeddedCount} chunks`);

          if (embeddedCount % 200 === 0) {
            console.error(`[indexer] ... ${embeddedCount} chunks embedded`);
          }
        }

        // Start next batch on the next pipeline instance
        const provider = embedders[ei % embedders.length];
        ei++;
        pending.push({
          chunks: batch,
          embeddings: provider.embed(
            batch.map((c) => c.text),
            signal,
          ),
        });
      }

      // Drain remaining in-flight batches
      for (const p of pending) {
        if (signal?.aborted) {
          throw new AbortError("Cancelled while draining pending embeddings");
        }
        const embeddings = await p.embeddings;
        for (let j = 0; j < p.chunks.length; j++) {
          storeEntries.push({
            embedding: embeddings[j],
            id: p.chunks[j].id,
            metadata: p.chunks[j].metadata,
            text: p.chunks[j].text,
          });
        }
        embeddedCount += p.chunks.length;
        progress("embed", embeddedCount, totalChunkCount, `Embedding: ${embeddedCount} chunks`);

        if (embeddedCount % 200 === 0) {
          console.error(`[indexer] ... ${embeddedCount} chunks embedded`);
        }
      }
    })();

    await Promise.all([producer, consumer]);

    const totalChunks = storeEntries.length;
    console.error(`[indexer] Created ${totalChunks} chunks, all embedded`);

    if (signal?.aborted) {
      throw new AbortError("Cancelled before storing");
    }
    progress("store", 0, storeEntries.length, `Storing ${storeEntries.length} entries...`);
    console.error(`[indexer] Storing ${storeEntries.length} entries...`);

    await store.repo.save({
      branch,
      // Update with total count in the store after incremental operations
      chunkCount: (await store.entry.countRepoEntries(repoName)) + storeEntries.length,
      indexedAt: new Date().toISOString(),
      repoName,
      repoUrl: repoRef,
      commitHash: newCommitHash,
    });

    if (signal?.aborted) {
      throw new AbortError("Cancelled before storing entries");
    }

    // oxlint-disable-next-line no-unused-expressions
    isIncremental
      ? await store.entry.insertBatch(storeEntries)
      : await store.entry.overwriteRepoEntries(repoName, storeEntries);

    const total = await store.entry.totalEntries();
    console.error(`[indexer] Done. Total vector store: ${total} entries`);

    progress("store", storeEntries.length, storeEntries.length, "Done");

    return { chunkCount: storeEntries.length, fileCount: files.length, repoName };
  } finally {
    for (const inst of embedders) {
      await inst.dispose();
    }
    await resetEmbedders();
  }
}
