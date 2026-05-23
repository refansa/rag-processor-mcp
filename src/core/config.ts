/**
 * Centralized configuration for rag-processor-mcp.
 *
 * Priority (highest wins):
 *   1. Environment variables (RAG_MCP_*)
 *   2. JSON config file (default: ~/.rag-mcp-server/config.json)
 *   3. Hardcoded defaults
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Config shape ────────────────────────────────────────────────────────

export interface StoreConfig {
  /** Backend provider: "json" (local files) or "postgresql" (server-based). */
  provider: "json" | "postgresql";
  /** Connection string (postgresql) or data directory (json). */
  url: string;
  /** Connection pool size (postgresql only). */
  poolSize: number;
}

export interface Config {
  /** Store backend configuration. */
  store: StoreConfig;

  /** Directory for all server data (store, repos, config). */
  dataDir: string;
  /** Subdirectory under dataDir for cloned repos. */
  reposDir: string;

  /** HuggingFace model ID for embeddings. */
  embedderModel: string;

  /** File extensions to include when scanning repos. */
  includeExts: string[];
  /** Directory names to skip when scanning repos. */
  excludeDirs: string[];
  /** Max file size in bytes to index (files larger are skipped). */
  maxFileBytes: number;

  /** Target chunk size in characters. */
  chunkSize: number;
  /** Overlap between consecutive chunks in characters. */
  chunkOverlap: number;

  /** Number of chunks to embed per batch (memory/performance trade-off). */
  embeddingBatchSize: number;

  /** Default number of search results. */
  defaultResults: number;
  /** Maximum allowed search results. */
  maxResults: number;
  /** Max characters of snippet content to return in search results. */
  snippetMaxChars: number;
}

// ── Defaults ────────────────────────────────────────────────────────────

const HOME = process.env.HOME || os.homedir();
const DEFAULT_DATA_DIR = path.join(HOME, ".rag-mcp-server");

export const DEFAULT_CONFIG: Config = {
  store: {
    poolSize: 5,
    provider: "json",
    url: DEFAULT_DATA_DIR,
  },
  chunkOverlap: 200,
  chunkSize: 1000,
  dataDir: DEFAULT_DATA_DIR,
  defaultResults: 5,
  embedderModel: "Xenova/all-MiniLM-L6-v2",
  embeddingBatchSize: 50,
  excludeDirs: [
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    ".git",
    "dist",
    "build",
    ".next",
    "target",
    ".ruff_cache",
    ".pytest_cache",
    "egg-info",
  ],
  includeExts: [
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".rs",
    ".go",
    ".java",
    ".kt",
    ".swift",
    ".md",
    ".yaml",
    ".yml",
    ".toml",
    ".json",
    ".css",
    ".scss",
    ".html",
  ],
  maxFileBytes: 50_000,
  maxResults: 20,
  reposDir: path.join(DEFAULT_DATA_DIR, "repos"),
  snippetMaxChars: 500,
};

// ── Config file loader ──────────────────────────────────────────────────

function loadConfigFile(configPath: string): Partial<Config> {
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return JSON.parse(raw) as Partial<Config>;
  } catch {
    return {};
  }
}

// ── Env var overrides ───────────────────────────────────────────────────

function loadEnvOverrides(): Partial<Config> {
  const { env } = process;
  const cfg: Partial<Config> = {};

  if (env.RAG_MCP_DATA_DIR) {
    cfg.dataDir = env.RAG_MCP_DATA_DIR;
  }
  if (env.RAG_MCP_REPOS_DIR) {
    cfg.reposDir = env.RAG_MCP_REPOS_DIR;
  }
  if (env.RAG_MCP_MODEL) {
    cfg.embedderModel = env.RAG_MCP_MODEL;
  }
  if (env.RAG_MCP_CHUNK_SIZE) {
    cfg.chunkSize = Number(env.RAG_MCP_CHUNK_SIZE);
  }
  if (env.RAG_MCP_CHUNK_OVERLAP) {
    cfg.chunkOverlap = Number(env.RAG_MCP_CHUNK_OVERLAP);
  }
  if (env.RAG_MCP_BATCH_SIZE) {
    cfg.embeddingBatchSize = Number(env.RAG_MCP_BATCH_SIZE);
  }
  if (env.RAG_MCP_MAX_FILE_BYTES) {
    cfg.maxFileBytes = Number(env.RAG_MCP_MAX_FILE_BYTES);
  }
  if (env.RAG_MCP_DEFAULT_RESULTS) {
    cfg.defaultResults = Number(env.RAG_MCP_DEFAULT_RESULTS);
  }
  if (env.RAG_MCP_MAX_RESULTS) {
    cfg.maxResults = Number(env.RAG_MCP_MAX_RESULTS);
  }
  if (env.RAG_MCP_SNIPPET_MAX) {
    cfg.snippetMaxChars = Number(env.RAG_MCP_SNIPPET_MAX);
  }

  // Store backend overrides
  if (env.RAG_MCP_STORE_PROVIDER) {
    cfg.store = {
      ...(cfg.store ?? DEFAULT_CONFIG.store),
      provider: env.RAG_MCP_STORE_PROVIDER as "json" | "postgresql",
    };
  }
  if (env.RAG_MCP_STORE_URL) {
    cfg.store = {
      ...(cfg.store ?? DEFAULT_CONFIG.store),
      url: env.RAG_MCP_STORE_URL,
    };
  }
  if (env.RAG_MCP_PG_POOL_SIZE) {
    cfg.store = {
      ...(cfg.store ?? DEFAULT_CONFIG.store),
      poolSize: Number(env.RAG_MCP_PG_POOL_SIZE),
    };
  }

  // Array overrides via JSON (e.g. RAG_MCP_INCLUDE_EXTS='[".ts",".js"]')
  if (env.RAG_MCP_INCLUDE_EXTS) {
    try {
      cfg.includeExts = JSON.parse(env.RAG_MCP_INCLUDE_EXTS);
    } catch {
      /* Skip */
    }
  }
  if (env.RAG_MCP_EXCLUDE_DIRS) {
    try {
      cfg.excludeDirs = JSON.parse(env.RAG_MCP_EXCLUDE_DIRS);
    } catch {
      /* Skip */
    }
  }

  return cfg;
}

// ── Merge & export ──────────────────────────────────────────────────────

let _config: Config | null = null;

export function getConfig(): Config {
  if (_config) {
    return _config;
  }

  const configFilePath = process.env.RAG_MCP_CONFIG || path.join(DEFAULT_DATA_DIR, "config.json");

  const fromFile = loadConfigFile(configFilePath);
  const fromEnv = loadEnvOverrides();

  _config = {
    ...DEFAULT_CONFIG,
    ...fromFile,
    ...fromEnv,
  };

  // Deep-merge nested store config: default ← file ← env
  _config.store = {
    ...DEFAULT_CONFIG.store,
    ...fromFile.store,
    ...fromEnv.store,
  };

  // Derive reposDir from dataDir if not explicitly set
  if (!fromFile.reposDir && !fromEnv.reposDir) {
    _config.reposDir = path.join(_config.dataDir, "repos");
  }

  // Normalize paths to forward slashes for cross-platform consistency
  if (_config.dataDir) {
    _config.dataDir = _config.dataDir.split(path.sep).join("/");
  }
  if (_config.reposDir) {
    _config.reposDir = _config.reposDir.split(path.sep).join("/");
  }

  console.error(`[config] Loaded (dataDir=${_config.dataDir})`);
  return _config;
}

/** Reset cached config (useful in tests). */
export function resetConfig(): void {
  _config = null;
}
