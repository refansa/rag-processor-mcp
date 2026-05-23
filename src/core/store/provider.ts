import type { IndexedRepo, SearchResult, StoreEntry } from "../types.js";

export interface SearchWhere {
  repo?: string;
  ext?: string;
}

export interface StoreProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  searchSimilar(
    queryEmbedding: number[],
    take: number,
    where?: SearchWhere,
  ): Promise<SearchResult[]>;

  insertOne(entry: StoreEntry): Promise<void>;
  insertBatch(entries: StoreEntry[]): Promise<void>;
  overwriteRepoEntries(repoName: string, entries: StoreEntry[]): Promise<void>;
  removeRepoEntries(repoName: string): Promise<void>;
  totalEntries(): Promise<number>;

  listAll(): Promise<IndexedRepo[]>;
  save(repo: IndexedRepo): Promise<void>;
  removeOne(repoName: string): Promise<void>;
}
