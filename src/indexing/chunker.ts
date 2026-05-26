/**
 * Text chunker: split file content into overlapping chunks for embedding.
 */

import type { Chunk, FileInfo } from "../core/types.js";
import { getConfig } from "../core/config.js";
import { chunkWithTreeSitter } from "./tree-sitter.js";

const cfg = getConfig();
export const CHUNK_SIZE = cfg.chunkSize;
export const CHUNK_OVERLAP = cfg.chunkOverlap;

export function countChunks(file: FileInfo): number {
  if (file.content.length === 0) {
    return 0;
  }
  if (file.content.length <= CHUNK_SIZE) {
    return 1;
  }
  return Math.ceil(file.content.length / (CHUNK_SIZE - CHUNK_OVERLAP));
}

export function chunkFile(file: FileInfo, repoName: string): Chunk[] {
  const { content, path: filePath, ext } = file;

  if (content.length === 0) {
    return [];
  }

  return chunkWithTreeSitter(content, filePath, repoName, ext);
}
