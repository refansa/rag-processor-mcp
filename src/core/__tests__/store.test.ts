import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rag-store-"));
  process.env.RAG_MCP_DATA_DIR = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tmpDir, { force: true, recursive: true });
  delete process.env.RAG_MCP_DATA_DIR;
});

function makeEntry(id: string, repoName: string, text = "some code") {
  return {
    embedding: Array(384).fill(0.1),
    id,
    metadata: {
      chunkIndex: 0,
      ext: ".ts",
      filePath: `src/${id}.ts`,
      repoName,
      totalChunks: 1,
    },
    text,
  };
}

describe("store", () => {
  it("starts empty", async () => {
    const { countEntries } = await import("../store.js");
    expect(countEntries()).toBe(0);
  });

  it("adds and counts entries", async () => {
    const { addEntries, countEntries } = await import("../store.js");
    addEntries([makeEntry("1", "repo-a")]);
    addEntries([makeEntry("2", "repo-a")]);
    expect(countEntries()).toBe(2);
  });

  it("searches by cosine similarity", async () => {
    const { addEntries, search } = await import("../store.js");

    // Add entries with distinct embeddings
    addEntries([
      { ...makeEntry("1", "repo-a", "hello world"), embedding: Array(384).fill(0.5) },
      { ...makeEntry("2", "repo-a", "goodbye world"), embedding: Array(384).fill(-0.5) },
    ]);

    // Query embedding close to entry 1
    const queryEmbedding = Array(384).fill(0.5);
    const results = search(queryEmbedding, 2);

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("1");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("returns search results with snippet", async () => {
    const { addEntries, search } = await import("../store.js");
    const longText = "A".repeat(1000);
    addEntries([makeEntry("big", "repo-a", longText)]);

    const queryEmbedding = Array(384).fill(0.1);
    const results = search(queryEmbedding, 1);

    expect(results).toHaveLength(1);
    // Snippet should be truncated to default length
    expect(results[0].content.length).toBeLessThanOrEqual(500);
  });

  it("atomically replaces entries for a repo", async () => {
    const { addEntries, replaceRepoEntries, countEntries, search } = await import("../store.js");

    addEntries([makeEntry("old1", "repo-a", "old code")]);
    addEntries([makeEntry("other", "repo-b", "other code")]);
    expect(countEntries()).toBe(2);

    // Replace repo-a entries — should keep repo-b intact
    replaceRepoEntries("repo-a", [
      makeEntry("new1", "repo-a", "new code"),
      makeEntry("new2", "repo-a", "more new"),
    ]);
    expect(countEntries()).toBe(3);

    // Verify repo-b is still there
    const queryEmbedding = Array(384).fill(0.1);
    const results = search(queryEmbedding, 10);
    const repoBResults = results.filter((r) => r.repo === "repo-b");
    expect(repoBResults).toHaveLength(1);
    expect(repoBResults[0].id).toContain("other");
  });

  it("lists indexed repos", async () => {
    const { recordRepo, getIndexedRepos } = await import("../store.js");

    recordRepo({
      chunkCount: 5,
      indexedAt: new Date().toISOString(),
      repoName: "repo-a",
      repoUrl: "https://github.com/user/repo.git",
    });

    const repos = getIndexedRepos();
    expect(repos).toHaveLength(1);
    expect(repos[0].repoName).toBe("repo-a");
  });

  it("removes a repo and its entries", async () => {
    const { addEntries, removeRepo, countEntries, getIndexedRepos } = await import("../store.js");

    addEntries([makeEntry("1", "repo-a")]);
    addEntries([makeEntry("2", "repo-b")]);
    expect(countEntries()).toBe(2);

    removeRepo("repo-a");
    expect(countEntries()).toBe(1);

    const repos = getIndexedRepos();
    expect(repos.every((r) => r.repoName !== "repo-a")).toBe(true);
  });
});
