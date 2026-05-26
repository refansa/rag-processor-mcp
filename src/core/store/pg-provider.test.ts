import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { PgProvider } from "./pg-provider.js";
import { StoreError } from "./errors.js";

// Mock the pg module
vi.mock("pg", () => {
  const mClient = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const mPool = {
    connect: vi.fn(() => Promise.resolve(mClient)),
    end: vi.fn(),
    on: vi.fn(),
    query: vi.fn(),
  };
  class MockPool {
    constructor() {
      return mPool;
    }
    static _mPool = mPool;
    static _mClient = mClient;
  }
  return {
    Pool: MockPool,
  };
});

describe("Store (PgProvider)", () => {
  let provider: PgProvider;
  let poolMock: any;
  let clientMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new PgProvider("postgres://localhost/test", 5, 3);
    poolMock = (Pool as any)._mPool;
    clientMock = (Pool as any)._mClient;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("connects and creates tables", async () => {
    await provider.connect();
    expect(poolMock.connect).toHaveBeenCalled();
    expect(clientMock.query).toHaveBeenCalledWith("CREATE EXTENSION IF NOT EXISTS vector");
    expect(clientMock.query).toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE IF NOT EXISTS indexed_repos"),
    );
    expect(clientMock.query).toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE IF NOT EXISTS store_entries"),
    );
    expect(clientMock.release).toHaveBeenCalled();
  });

  it("getFileEntries returns parsed embeddings", async () => {
    const mockRows = [
      {
        id: "1",
        text: "test text",
        embedding: "[0.1,0.2,0.3]",
        chunk_index: 0,
        ext: ".ts",
        file_path: "src/test.ts",
        repo_name: "test-repo",
        total_chunks: 1,
      },
    ];
    poolMock.query.mockResolvedValueOnce({ rows: mockRows });

    const entries = await provider.getFileEntries("test-repo", "src/test.ts");

    expect(poolMock.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "SELECT id, repo_name, file_path, ext, chunk_index, total_chunks, text, embedding",
      ),
      ["test-repo", "src/test.ts"],
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(entries[0].text).toBe("test text");
  });

  it("getFileEntries handles empty embedding", async () => {
    const mockRows = [
      {
        id: "1",
        text: "test text",
        embedding: null,
        chunk_index: 0,
        ext: ".ts",
        file_path: "src/test.ts",
        repo_name: "test-repo",
        total_chunks: 1,
      },
    ];
    poolMock.query.mockResolvedValueOnce({ rows: mockRows });

    const entries = await provider.getFileEntries("test-repo", "src/test.ts");

    expect(entries).toHaveLength(1);
    expect(entries[0].embedding).toEqual([]);
  });

  it("removeRepoEntries deletes entries and updates chunk_count", async () => {
    await provider.removeRepoEntries("test-repo");

    expect(poolMock.connect).toHaveBeenCalled();
    expect(clientMock.query).toHaveBeenCalledWith("BEGIN");
    expect(clientMock.query).toHaveBeenCalledWith(
      "DELETE FROM store_entries WHERE repo_name = $1",
      ["test-repo"],
    );
    expect(clientMock.query).toHaveBeenCalledWith(
      "UPDATE indexed_repos SET chunk_count = 0 WHERE repo_name = $1",
      ["test-repo"],
    );
    expect(clientMock.query).toHaveBeenCalledWith("COMMIT");
    expect(clientMock.release).toHaveBeenCalled();
  });

  it("removeRepoEntries rolls back on error", async () => {
    clientMock.query.mockImplementation((query: string) => {
      if (query.includes("DELETE")) {
        throw new Error("DB Error");
      }
      return Promise.resolve();
    });

    await expect(provider.removeRepoEntries("test-repo")).rejects.toThrow(StoreError);

    expect(clientMock.query).toHaveBeenCalledWith("ROLLBACK");
    expect(clientMock.release).toHaveBeenCalled();
  });
});
