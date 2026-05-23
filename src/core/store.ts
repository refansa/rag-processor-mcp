/**
 * Lightweight vector store with cosine similarity search.
 * Persisted to JSON on every write (atomic writes via write-to-tmp + rename).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { IndexedRepo, SearchResult, StoreEntry } from "./types.js";
import { getConfig } from "./config.js";

const cfg = getConfig();
const ENTRIES_FILE = path.join(cfg.dataDir, "entries.json");
const REPOS_FILE = path.join(cfg.dataDir, "repos.json");

function ensureDir() {
  fs.mkdirSync(cfg.dataDir, { recursive: true });
}

/** Write to a temp file then rename — prevents corruption if the process crashes mid-write. */
function atomicWrite(filePath: string, data: string) {
  ensureDir();
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, data, "utf8");
  fs.renameSync(tmp, filePath);
}

function loadEntries(): StoreEntry[] {
  try {
    return JSON.parse(fs.readFileSync(ENTRIES_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveEntries(entries: StoreEntry[]) {
  atomicWrite(ENTRIES_FILE, JSON.stringify(entries, null, 2));
}

function loadRepos(): IndexedRepo[] {
  try {
    return JSON.parse(fs.readFileSync(REPOS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveRepos(repos: IndexedRepo[]) {
  atomicWrite(REPOS_FILE, JSON.stringify(repos, null, 2));
}

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

export function addEntries(entries: StoreEntry[]) {
  const existing = loadEntries();
  existing.push(...entries);
  saveEntries(existing);
}

export function search(queryEmbedding: number[], nResults: number = 5): SearchResult[] {
  const entries = loadEntries();
  if (entries.length === 0) {
    return [];
  }

  const scored = entries
    .map((entry) => ({
      entry,
      score: cosineSimilarity(queryEmbedding, entry.embedding),
    }))
    .toSorted((a, b) => b.score - a.score)
    .slice(0, nResults);

  return scored.map((s) => ({
    content: s.entry.text.slice(0, cfg.snippetMaxChars),
    file: s.entry.metadata.filePath,
    id: s.entry.id,
    repo: s.entry.metadata.repoName,
    score: s.score,
  }));
}

export function removeRepo(repoName: string) {
  const entries = loadEntries();
  const filtered = entries.filter((e) => e.metadata.repoName !== repoName);
  saveEntries(filtered);

  const repos = loadRepos();
  saveRepos(repos.filter((r) => r.repoName !== repoName));
}

/**
 * Atomically replace all entries for a repo — single write, no data-loss window.
 * Unlike the old removeRepo() + addEntries() two-step, this never leaves the
 * store in a half-written state.
 */
export function replaceRepoEntries(repoName: string, newEntries: StoreEntry[]): void {
  const all = loadEntries();
  const kept = all.filter((e) => e.metadata.repoName !== repoName);
  kept.push(...newEntries);
  saveEntries(kept);
}

export function getIndexedRepos(): IndexedRepo[] {
  return loadRepos();
}

export function recordRepo(repo: IndexedRepo) {
  const repos = loadRepos();
  const filtered = repos.filter((r) => r.repoName !== repo.repoName);
  filtered.push(repo);
  saveRepos(filtered);
}

export function countEntries(): number {
  return loadEntries().length;
}
