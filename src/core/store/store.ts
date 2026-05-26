import type { IndexedRepo, SearchResult, StoreEntry } from "../types.js";
import type { SearchWhere, StoreProvider } from "./provider.js";
import { JsonProvider } from "./json-provider.js";
import { PgProvider } from "./pg-provider.js";
import { getConfig } from "../config.js";

export interface StoreOptions {
  provider: "json" | "postgresql";
  url: string;
  poolSize?: number;
  embeddingDimension?: number;
}

export class Store {
  public readonly entry: EntryStore;
  public readonly repo: RepoStore;
  private readonly provider: StoreProvider;

  constructor(opts: StoreOptions) {
    this.provider =
      opts.provider === "postgresql"
        ? new PgProvider(opts.url, opts.poolSize ?? 5, opts.embeddingDimension)
        : new JsonProvider(opts.url);
    this.entry = new EntryStore(this.provider);
    this.repo = new RepoStore(this.provider);
  }

  async $connect(): Promise<void> {
    await this.provider.connect();
  }

  async $disconnect(): Promise<void> {
    await this.provider.disconnect();
  }
}

export class EntryStore {
  private readonly provider: StoreProvider;
  private readonly chunkOverlap: number;

  constructor(provider: StoreProvider) {
    this.provider = provider;
    this.chunkOverlap = getConfig().chunkOverlap;
  }

  searchSimilar(
    queryEmbedding: number[],
    opts?: { take?: number; where?: SearchWhere },
  ): Promise<SearchResult[]> {
    return this.provider.searchSimilar(queryEmbedding, opts?.take ?? 5, opts?.where);
  }

  insertOne(entry: StoreEntry): Promise<void> {
    return this.provider.insertOne(entry);
  }

  insertBatch(entries: StoreEntry[]): Promise<void> {
    return this.provider.insertBatch(entries);
  }

  overwriteRepoEntries(repoName: string, entries: StoreEntry[]): Promise<void> {
    return this.provider.overwriteRepoEntries(repoName, entries);
  }

  removeRepoEntries(repoName: string): Promise<void> {
    return this.provider.removeRepoEntries(repoName);
  }

  async getRepoFiles(repoName: string): Promise<string[]> {
    return this.provider.getRepoFiles(repoName);
  }

  async getFileContent(
    repoName: string,
    filePath: string,
  ): Promise<{
    repo: string;
    file: string;
    ext: string;
    content: string;
    totalChunks: number;
  } | null> {
    const chunks = await this.provider.getFileEntries(repoName, filePath);
    if (chunks.length === 0) {
      return null;
    }

    let content = chunks[0].text;
    for (let i = 1; i < chunks.length; i++) {
      content += chunks[i].text.slice(this.chunkOverlap);
    }

    return {
      content,
      ext: chunks[0].metadata.ext,
      file: filePath,
      repo: repoName,
      totalChunks: chunks.length,
    };
  }

  totalEntries(): Promise<number> {
    return this.provider.totalEntries();
  }
}

export class RepoStore {
  private readonly provider: StoreProvider;

  constructor(provider: StoreProvider) {
    this.provider = provider;
  }

  listAll(): Promise<IndexedRepo[]> {
    return this.provider.listAll();
  }

  save(repo: IndexedRepo): Promise<void> {
    return this.provider.save(repo);
  }

  removeOne(repoName: string): Promise<void> {
    return this.provider.removeOne(repoName);
  }
}
