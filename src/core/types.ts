/** Shared types for the RAG code MCP server */

export interface FileInfo {
  path: string;
  content: string;
  ext: string;
}

export interface ChunkMetadata {
  repoName: string;
  filePath: string;
  ext: string;
  chunkIndex: number;
  totalChunks: number;
}

export interface Chunk {
  id: string;
  text: string;
  metadata: ChunkMetadata;
}

export interface SearchResult {
  id: string;
  score: number;
  repo: string;
  file: string;
  content: string;
}

export interface StoreEntry {
  id: string;
  text: string;
  embedding: number[];
  metadata: ChunkMetadata;
}

export interface IndexedRepo {
  repoUrl: string;
  repoName: string;
  indexedAt: string;
  chunkCount: number;
}
