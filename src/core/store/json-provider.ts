import * as fs from "node:fs";
import * as path from "node:path";
import MiniSearch from "minisearch";
import type { IndexedRepo, SearchResult, StoreEntry } from "../types.js";
import type { SearchWhere, StoreProvider } from "./provider.js";
import { fuseResults } from "../rrf.js";
import { getConfig } from "../config.js";

const cfg = getConfig();

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export class JsonProvider implements StoreProvider {
  private dataDir: string;
  private entriesFile: string;
  private reposFile: string;
  private entries: StoreEntry[] = [];
  private repos: IndexedRepo[] = [];
  private miniSearch = new MiniSearch<StoreEntry>({
    fields: ["text"], // fields to index for full-text search
    idField: "id",
    extractField: (document, fieldName) => {
      if (fieldName === "text") {
        return document.text;
      }
      return (document as any)[fieldName];
    },
  });

  constructor(url?: string) {
    this.dataDir = url ?? cfg.dataDir;
    this.entriesFile = path.join(this.dataDir, "entries.json");
    this.reposFile = path.join(this.dataDir, "repos.json");
  }

  async connect(): Promise<void> {
    this.ensureDir();
    this.entries = this.loadEntries();
    this.repos = this.loadRepos();
    if (this.entries.length > 0) {
      this.miniSearch.addAll(this.entries);
    }
  }

  async disconnect(): Promise<void> {
    // no-op for file-based storage
  }

  // ── Entry operations ────────────────────────────────────────────────

  async getRepoFiles(repoName: string): Promise<string[]> {
    const files = new Set<string>();
    for (const e of this.entries) {
      if (e.metadata.repoName === repoName) {
        files.add(e.metadata.filePath);
      }
    }
    return [...files].toSorted();
  }

  async getFileEntries(repoName: string, filePath: string): Promise<StoreEntry[]> {
    return this.entries
      .filter((e) => e.metadata.repoName === repoName && e.metadata.filePath === filePath)
      .toSorted((a, b) => a.metadata.chunkIndex - b.metadata.chunkIndex);
  }

  async searchSimilar(
    queryText: string,
    queryEmbedding: number[],
    take: number,
    _where?: SearchWhere,
  ): Promise<SearchResult[]> {
    const ext = _where?.ext?.toLowerCase();

    // Filter function reused for both vector and keyword search candidates
    const filterFn = (e: StoreEntry) => {
      if (_where?.repo && e.metadata.repoName !== _where.repo) {
        return false;
      }
      if (ext && e.metadata.ext !== ext) {
        return false;
      }
      return true;
    };

    const candidates = this.entries.filter(filterFn);

    const vectorScored = candidates
      .map((entry) => ({
        content: entry.text.slice(0, cfg.snippetMaxChars),
        file: entry.metadata.filePath,
        id: entry.id,
        repo: entry.metadata.repoName,
        score: cosineSimilarity(queryEmbedding, entry.embedding),
      }))
      .toSorted((a, b) => b.score - a.score)
      .slice(0, take);

    // MiniSearch allows us to run text queries
    // We apply the same repo/ext filters using its filter option
    const keywordResults = this.miniSearch.search(queryText, {
      filter: (result) => {
        const entry = this.entries.find((e) => e.id === result.id);
        return entry ? filterFn(entry) : false;
      },
    });

    const keywordScored = keywordResults.slice(0, take).map((result) => {
      const entry = this.entries.find((e) => e.id === result.id)!;
      return {
        content: entry.text.slice(0, cfg.snippetMaxChars),
        file: entry.metadata.filePath,
        id: entry.id,
        repo: entry.metadata.repoName,
        score: result.score,
      };
    });

    return fuseResults(vectorScored, keywordScored).slice(0, take);
  }

  async insertOne(entry: StoreEntry): Promise<void> {
    this.entries.push(entry);
    this.miniSearch.add(entry);
    this.saveEntries();
  }

  async insertBatch(entries: StoreEntry[]): Promise<void> {
    this.entries.push(...entries);
    this.miniSearch.addAll(entries);
    this.saveEntries();
  }

  async overwriteRepoEntries(repoName: string, entries: StoreEntry[]): Promise<void> {
    const toRemove = this.entries.filter((e) => e.metadata.repoName === repoName);
    this.miniSearch.removeAll(toRemove);
    const kept = this.entries.filter((e) => e.metadata.repoName !== repoName);
    kept.push(...entries);
    this.entries = kept;
    this.miniSearch.addAll(entries);
    this.saveEntries();
  }

  async removeRepoEntries(repoName: string): Promise<void> {
    const toRemove = this.entries.filter((e) => e.metadata.repoName === repoName);
    this.miniSearch.removeAll(toRemove);
    this.entries = this.entries.filter((e) => e.metadata.repoName !== repoName);
    this.saveEntries();
  }

  async removeFileEntries(repoName: string, filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) {
      return;
    }
    const pathsSet = new Set(filePaths);
    const toRemove = this.entries.filter(
      (e) => e.metadata.repoName === repoName && pathsSet.has(e.metadata.filePath),
    );
    this.miniSearch.removeAll(toRemove);
    this.entries = this.entries.filter(
      (e) => !(e.metadata.repoName === repoName && pathsSet.has(e.metadata.filePath)),
    );
    this.saveEntries();
  }

  async totalEntries(): Promise<number> {
    return this.entries.length;
  }

  async countRepoEntries(repoName: string): Promise<number> {
    return this.entries.filter((e) => e.metadata.repoName === repoName).length;
  }

  // ── Repo operations ──────────────────────────────────────────────────

  async listAll(): Promise<IndexedRepo[]> {
    return this.repos;
  }

  async save(repo: IndexedRepo): Promise<void> {
    const filtered = this.repos.filter((r) => r.repoName !== repo.repoName);
    filtered.push(repo);
    this.repos = filtered;
    this.saveRepos();
  }

  async removeOne(repoName: string): Promise<void> {
    this.repos = this.repos.filter((r) => r.repoName !== repoName);
    const toRemove = this.entries.filter((e) => e.metadata.repoName === repoName);
    this.miniSearch.removeAll(toRemove);
    this.entries = this.entries.filter((e) => e.metadata.repoName !== repoName);
    this.saveRepos();
    this.saveEntries();
  }

  // ── Internal helpers ─────────────────────────────────────────────────

  private ensureDir() {
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  private atomicWrite(filePath: string, data: string) {
    const tmp = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, filePath);
  }

  private loadEntries(): StoreEntry[] {
    try {
      return JSON.parse(fs.readFileSync(this.entriesFile, "utf8"));
    } catch {
      return [];
    }
  }

  private saveEntries() {
    this.atomicWrite(this.entriesFile, JSON.stringify(this.entries, null, 2));
  }

  private loadRepos(): IndexedRepo[] {
    try {
      return JSON.parse(fs.readFileSync(this.reposFile, "utf8"));
    } catch {
      return [];
    }
  }

  private saveRepos() {
    this.atomicWrite(this.reposFile, JSON.stringify(this.repos, null, 2));
  }
}
