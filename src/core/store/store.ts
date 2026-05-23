import type { IndexedRepo, SearchResult, StoreEntry } from "../types.js";
import type { SearchWhere, StoreProvider } from "./provider.js";
import { JsonProvider } from "./json-provider.js";
import { PgProvider } from "./pg-provider.js";

export interface StoreOptions {
  provider: "json" | "postgresql";
  url: string;
  poolSize?: number;
}

export class Store {
  public readonly entry: EntryStore;
  public readonly repo: RepoStore;
  private readonly provider: StoreProvider;

  constructor(opts: StoreOptions) {
    this.provider =
      opts.provider === "postgresql"
        ? new PgProvider(opts.url, opts.poolSize ?? 5)
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

  constructor(provider: StoreProvider) {
    this.provider = provider;
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
