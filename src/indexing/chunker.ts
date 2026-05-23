/**
 * Text chunker: split file content into overlapping chunks for embedding.
 */

import type { Chunk, FileInfo } from "../core/types.js";
import { getConfig } from "../core/config.js";

const cfg = getConfig();
export const CHUNK_SIZE = cfg.chunkSize;
export const CHUNK_OVERLAP = cfg.chunkOverlap;

export function chunkFile(file: FileInfo, repoName: string): Chunk[] {
  const { content, path: filePath, ext } = file;
  const chunks: Chunk[] = [];

  if (content.length <= CHUNK_SIZE) {
    chunks.push({
      id: `${repoName}::${filePath}::0`,
      metadata: { chunkIndex: 0, ext, filePath, repoName, totalChunks: 1 },
      text: content,
    });
    return chunks;
  }

  let index = 0;
  for (let i = 0; i < content.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    const end = Math.min(i + CHUNK_SIZE, content.length);
    const text = content.slice(i, end);
    chunks.push({
      id: `${repoName}::${filePath}::${index}`,
      metadata: {
        chunkIndex: index,
        ext,
        filePath,
        repoName,
        totalChunks: Math.ceil(content.length / (CHUNK_SIZE - CHUNK_OVERLAP)),
      },
      text,
    });
    index++;
  }

  return chunks;
}
