import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileInfo } from "../../core/types.js";

beforeEach(() => {
  vi.resetModules();
});

describe("chunkFile", () => {
  it("returns a single chunk for small files", async () => {
    // Set a known chunk size
    process.env.RAG_MCP_CHUNK_SIZE = "100";
    process.env.RAG_MCP_CHUNK_OVERLAP = "20";
    const { chunkFile } = await import("../chunker.js");

    const file: FileInfo = {
      content: "short content",
      ext: ".ts",
      path: "hello.ts",
    };

    const chunks = chunkFile(file, "my-repo");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].id).toBe("my-repo::hello.ts::0");
    expect(chunks[0].text).toBe("short content");
  });

  it("splits long content into overlapping chunks", async () => {
    process.env.RAG_MCP_CHUNK_SIZE = "50";
    process.env.RAG_MCP_CHUNK_OVERLAP = "10";
    const { chunkFile } = await import("../chunker.js");

    // 120 chars — should produce 3 chunks with overlap
    const file: FileInfo = {
      content: "a".repeat(120),
      ext: ".ts",
      path: "long.ts",
    };

    const chunks = chunkFile(file, "my-repo");
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0].metadata.chunkIndex).toBe(0);
    expect(chunks[0].metadata.repoName).toBe("my-repo");
    expect(chunks[0].metadata.filePath).toBe("long.ts");
  });

  it("numbers chunks sequentially", async () => {
    process.env.RAG_MCP_CHUNK_SIZE = "30";
    process.env.RAG_MCP_CHUNK_OVERLAP = "5";
    const { chunkFile } = await import("../chunker.js");

    const file: FileInfo = {
      content: "x".repeat(100),
      ext: ".ts",
      path: "multi.ts",
    };

    const chunks = chunkFile(file, "repo");
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].metadata.chunkIndex).toBe(i);
    }
  });

  it("has overlapping content between adjacent chunks", async () => {
    process.env.RAG_MCP_CHUNK_SIZE = "30";
    process.env.RAG_MCP_CHUNK_OVERLAP = "10";
    const { chunkFile } = await import("../chunker.js");

    const file: FileInfo = {
      content: `abcdefghijklmnopqrstuvwxyz${"abcdefghijklmnopqrstuvwxyz".repeat(3)}`,
      ext: ".ts",
      path: "overlap.ts",
    };

    const chunks = chunkFile(file, "repo");
    if (chunks.length >= 2) {
      // The tail of chunk 0 should appear in chunk 1 (overlap)
      expect(chunks[1].text).toContain(chunks[0].text.slice(-10));
    }
  });
});
