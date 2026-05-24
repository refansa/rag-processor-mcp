import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Store original env so we can restore after each test
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  // Clear any RAG_MCP_* env vars between tests
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("RAG_MCP_")) {
      delete process.env[key];
    }
  }
});

// Restore env after all tests
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("config defaults", () => {
  it("provides sensible defaults", async () => {
    const { getConfig } = await import("../config.js");
    const cfg = getConfig();

    expect(cfg.embedder.provider).toBe("local");
    expect(cfg.embedder.model).toBe("Xenova/all-MiniLM-L6-v2");
    expect(cfg.embedder.concurrency).toBeGreaterThanOrEqual(1);
    expect(cfg.chunkSize).toBe(1000);
    expect(cfg.chunkOverlap).toBe(200);
    expect(cfg.embeddingBatchSize).toBe(200);
    expect(cfg.maxFileBytes).toBe(50_000);
    expect(cfg.defaultResults).toBe(5);
    expect(cfg.maxResults).toBe(20);
    expect(cfg.snippetMaxChars).toBe(500);
  });

  it("includes known file extensions", async () => {
    const { getConfig } = await import("../config.js");
    const cfg = getConfig();

    expect(cfg.includeExts).toContain(".ts");
    expect(cfg.includeExts).toContain(".py");
    expect(cfg.includeExts).toContain(".go");
    expect(cfg.includeExts).toContain(".rs");
  });

  it("excludes common build artifacts", async () => {
    const { getConfig } = await import("../config.js");
    const cfg = getConfig();

    expect(cfg.excludeDirs).toContain("node_modules");
    expect(cfg.excludeDirs).toContain(".git");
    expect(cfg.excludeDirs).toContain("dist");
  });
});

describe("config env overrides", () => {
  it("overrides dataDir via RAG_MCP_DATA_DIR", async () => {
    process.env.RAG_MCP_DATA_DIR = "/tmp/rag-test";
    const { getConfig, resetConfig } = await import("../config.js");
    resetConfig();
    const cfg = getConfig();

    expect(cfg.dataDir).toBe("/tmp/rag-test");
    expect(cfg.reposDir).toBe("/tmp/rag-test/repos");
  });

  it("overrides numeric values via env", async () => {
    process.env.RAG_MCP_CHUNK_SIZE = "500";
    process.env.RAG_MCP_BATCH_SIZE = "10";
    const { getConfig, resetConfig } = await import("../config.js");
    resetConfig();
    const cfg = getConfig();

    expect(cfg.chunkSize).toBe(500);
    expect(cfg.embeddingBatchSize).toBe(10);
  });

  it("overrides arrays via JSON env vars", async () => {
    process.env.RAG_MCP_INCLUDE_EXTS = JSON.stringify([".ts", ".tsx"]);
    const { getConfig, resetConfig } = await import("../config.js");
    resetConfig();
    const cfg = getConfig();

    expect(cfg.includeExts).toEqual([".ts", ".tsx"]);
  });

  it("overrides embedder provider via RAG_MCP_EMBED_PROVIDER", async () => {
    process.env.RAG_MCP_EMBED_PROVIDER = "openai";
    const { getConfig, resetConfig } = await import("../config.js");
    resetConfig();
    const cfg = getConfig();

    expect(cfg.embedder.provider).toBe("openai");
  });

  it("overrides embedder model via RAG_MCP_MODEL", async () => {
    process.env.RAG_MCP_MODEL = "text-embedding-3-large";
    const { getConfig, resetConfig } = await import("../config.js");
    resetConfig();
    const cfg = getConfig();

    expect(cfg.embedder.model).toBe("text-embedding-3-large");
  });

  it("overrides embedder model via RAG_MCP_EMBED_MODEL", async () => {
    process.env.RAG_MCP_EMBED_MODEL = "cohere/embed-english-v3";
    const { getConfig, resetConfig } = await import("../config.js");
    resetConfig();
    const cfg = getConfig();

    expect(cfg.embedder.model).toBe("cohere/embed-english-v3");
  });

  it("overrides embedder apiKey via RAG_MCP_EMBED_API_KEY", async () => {
    process.env.RAG_MCP_EMBED_API_KEY = "sk-test-123";
    const { getConfig, resetConfig } = await import("../config.js");
    resetConfig();
    const cfg = getConfig();

    expect(cfg.embedder.apiKey).toBe("sk-test-123");
  });

  it("overrides embedder baseUrl via RAG_MCP_EMBED_BASE_URL", async () => {
    process.env.RAG_MCP_EMBED_BASE_URL = "https://api.deepseek.com";
    const { getConfig, resetConfig } = await import("../config.js");
    resetConfig();
    const cfg = getConfig();

    expect(cfg.embedder.baseUrl).toBe("https://api.deepseek.com");
  });

  it("clamps embedder concurrency to minimum 1", async () => {
    process.env.RAG_MCP_EMBED_CONCURRENCY = "0";
    const { getConfig, resetConfig } = await import("../config.js");
    resetConfig();
    const cfg = getConfig();

    expect(cfg.embedder.concurrency).toBe(1);
  });
});
