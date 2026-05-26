import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rag-store-"));
  process.env.RAG_MCP_DATA_DIR = tmpDir;
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

describe("Store (JSON provider)", () => {
  it("starts empty", async () => {
    const { Store } = await import("../store/index.js");
    const store = new Store({ provider: "json", url: tmpDir });
    await store.$connect();
    const count = await store.entry.totalEntries();
    expect(count).toBe(0);
    await store.$disconnect();
  });

  it("adds and counts entries", async () => {
    const { Store } = await import("../store/index.js");
    const store = new Store({ provider: "json", url: tmpDir });
    await store.$connect();
    await store.entry.insertOne(makeEntry("1", "repo-a"));
    await store.entry.insertOne(makeEntry("2", "repo-a"));
    expect(await store.entry.totalEntries()).toBe(2);
    await store.$disconnect();
  });

  it("searches by cosine similarity", async () => {
    const { Store } = await import("../store/index.js");
    const store = new Store({ provider: "json", url: tmpDir });
    await store.$connect();

    await store.entry.insertBatch([
      { ...makeEntry("1", "repo-a", "hello world"), embedding: Array(384).fill(0.5) },
      { ...makeEntry("2", "repo-a", "goodbye world"), embedding: Array(384).fill(-0.5) },
    ]);

    const queryEmbedding = Array(384).fill(0.5);
    const results = await store.entry.searchSimilar("test query", queryEmbedding, 2);

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("1");
    expect(results[0].score).toBeGreaterThan(results[1].score);
    await store.$disconnect();
  });

  it("returns search results with snippet", async () => {
    const { Store } = await import("../store/index.js");
    const store = new Store({ provider: "json", url: tmpDir });
    await store.$connect();

    const longText = "A".repeat(1000);
    await store.entry.insertOne(makeEntry("big", "repo-a", longText));

    const queryEmbedding = Array(384).fill(0.1);
    const results = await store.entry.searchSimilar("test query", queryEmbedding, 1);

    expect(results).toHaveLength(1);
    expect(results[0].content.length).toBeLessThanOrEqual(500);
    await store.$disconnect();
  });

  it("atomically replaces entries for a repo", async () => {
    const { Store } = await import("../store/index.js");
    const store = new Store({ provider: "json", url: tmpDir });
    await store.$connect();

    await store.entry.insertOne(makeEntry("old1", "repo-a", "old code"));
    await store.entry.insertOne(makeEntry("other", "repo-b", "other code"));
    expect(await store.entry.totalEntries()).toBe(2);

    await store.entry.overwriteRepoEntries("repo-a", [
      makeEntry("new1", "repo-a", "new code"),
      makeEntry("new2", "repo-a", "more new"),
    ]);
    expect(await store.entry.totalEntries()).toBe(3);

    const queryEmbedding = Array(384).fill(0.1);
    const results = await store.entry.searchSimilar("test query", queryEmbedding, 10);
    const repoBResults = results.filter((r: { repo: string }) => r.repo === "repo-b");
    expect(repoBResults).toHaveLength(1);
    expect(repoBResults[0].id).toContain("other");
    await store.$disconnect();
  });

  it("lists indexed repos", async () => {
    const { Store } = await import("../store/index.js");
    const store = new Store({ provider: "json", url: tmpDir });
    await store.$connect();

    await store.repo.save({
      chunkCount: 5,
      indexedAt: new Date().toISOString(),
      repoName: "repo-a",
      repoUrl: "https://github.com/user/repo.git",
    });

    const repos = await store.repo.listAll();
    expect(repos).toHaveLength(1);
    expect(repos[0].repoName).toBe("repo-a");
    await store.$disconnect();
  });

  it("removes a repo and its entries", async () => {
    const { Store } = await import("../store/index.js");
    const store = new Store({ provider: "json", url: tmpDir });
    await store.$connect();

    await store.entry.insertOne(makeEntry("1", "repo-a"));
    await store.entry.insertOne(makeEntry("2", "repo-b"));
    expect(await store.entry.totalEntries()).toBe(2);

    await store.repo.removeOne("repo-a");
    expect(await store.entry.totalEntries()).toBe(1);

    const repos = await store.repo.listAll();
    expect(repos.every((r: { repoName: string }) => r.repoName !== "repo-a")).toBe(true);
    await store.$disconnect();
  });
  it("getRepoFiles returns unique sorted paths", async () => {
    const { Store } = await import("../store/index.js");
    const store = new Store({ provider: "json", url: tmpDir });
    await store.$connect();

    await store.entry.insertOne(makeEntry("1", "repo-c", "code 1"));
    const entry2 = makeEntry("2", "repo-c", "code 2");
    entry2.metadata.filePath = "src/other.ts";
    await store.entry.insertOne(entry2);

    const files = await store.entry.getRepoFiles("repo-c");
    expect(files).toEqual(["src/1.ts", "src/other.ts"]);
    await store.$disconnect();
  });
});
