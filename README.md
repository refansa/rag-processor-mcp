# rag-processor-mcp

[![Node.js 18+](https://img.shields.io/badge/node-18+-blue.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-5.5+-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

MCP server for **semantic search over code repositories**. Index any Git repo — local or remote — then query it by meaning, not keywords.

## Overview

**rag-processor-mcp** is a Model Context Protocol server that enables AI tools to search code repositories semantically. Unlike keyword-based search, it understands the meaning behind your queries, finding relevant code patterns, utilities, and project structures across all your indexed repositories.

- Index repositories by Git URL or local filesystem path
- Search across all indexed repos using natural language queries
- Retrieve full file contents or directory tree from indexed repos
- List currently indexed repositories
- Support multiple embedding backends (local ONNX, OpenAI, Cohere)
- Store vectors in JSON files or PostgreSQL with pgvector

## Features

### Semantic Code Search

- **Meaning-based retrieval**: Query by intent — find logging utilities, auth patterns, or config handling without guessing exact function names
- **Multi-repo search**: Search across all indexed repositories simultaneously, results ranked by cosine similarity
- **File content retrieval**: Get complete file contents reconstructed from stored chunks
- **Repository structure**: View ASCII file tree of any indexed repository

### Flexible Embedding Providers

| Provider | Default Model | Runtime |
|----------|--------------|---------|
| **Local** (Xenova Transformers / ONNX) | `Xenova/all-MiniLM-L6-v2` | In-process, no API key needed |
| **OpenAI** | `text-embedding-3-small` | Remote API |
| **Cohere** | `embed-english-v3.0` | Remote API |

### Portable & Scalable Storage

| Storage | Description | Use Case |
|---------|-------------|----------|
| **JSON** | File-based vector store at `~/.rag-mcp-server/` | Default, no setup needed |
| **PostgreSQL** | pgvector-backed storage | Production, multi-client |

### Indexing Pipeline

- **Tree-sitter aware chunking**: Uses tree-sitter for structure-aware code chunking
- **Incremental indexing**: Detects changed files between commits via `git diff` — only re-indexes what changed
- **File type filtering**: `.py`, `.ts`, `.tsx`, `.js`, `.jsx`, `.rs`, `.go`, `.java`, `.kt`, `.swift`, `.md`, `.yaml`, `.yml`, `.toml`, `.json`, `.css`, `.scss`, `.html`, `.vue`
- **Smart exclusions**: Skips `node_modules`, `__pycache__`, `.venv`, `venv`, `.git`, `dist`, `build`, `.next`, `target`, `.ruff_cache`, `.pytest_cache`, `egg-info`
- **Size limits**: Files over 50 KB are ignored
- **Chunking**: Files split into overlapping chunks (configurable size and overlap)
- **Parallel embedding**: Batched embedding with configurable concurrency

## Installation

### Prerequisites

- Node.js 18 or higher
- pnpm (recommended), npm, or yarn

### Setup

```bash
git clone https://github.com/refansa/rag-processor-mcp.git
cd rag-processor-mcp
pnpm install
pnpm run build
```

## Configuration

Three-layer priority: hardcoded defaults < `~/.rag-mcp-server/config.json` < `RAG_MCP_*` env vars. Deep-merge for nested `store` and `embedder` objects. Paths normalized to forward slashes.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RAG_MCP_DATA_DIR` | Directory for vector store and cloned repos | `~/.rag-mcp-server` |
| `RAG_MCP_REPOS_DIR` | Subdirectory for cloned repos | `<dataDir>/repos` |
| `RAG_MCP_CONFIG` | Path to JSON config file | `<dataDir>/config.json` |
| `RAG_MCP_TRANSPORT` | Transport mode (`stdio` or `http`) | `stdio` |
| `RAG_MCP_PORT` | HTTP server port | `3000` |
| `RAG_MCP_STORE_PROVIDER` | Storage backend (`json` or `postgresql`) | `json` |
| `RAG_MCP_STORE_URL` | Connection URL (DB for pg, path for json) | `<dataDir>` |
| `RAG_MCP_PG_POOL_SIZE` | PostgreSQL connection pool size | `5` |
| `RAG_MCP_EMBEDDING_DIMENSION` | Embedding vector dimension | `384` |
| `RAG_MCP_EMBED_PROVIDER` | Embedding provider (`local`, `openai`, `cohere`) | `local` |
| `RAG_MCP_MODEL` / `RAG_MCP_EMBED_MODEL` | Embedding model name (latter wins) | Provider default |
| `RAG_MCP_EMBED_API_KEY` | API key for remote providers | (none) |
| `RAG_MCP_EMBED_BASE_URL` | Custom base URL (OpenAI-compatible APIs) | (none) |
| `RAG_MCP_EMBED_CONCURRENCY` | Parallel embedder instances | `max(1, CPUs-1)` |
| `RAG_MCP_CHUNK_SIZE` | Target chunk size in characters | `1000` |
| `RAG_MCP_CHUNK_OVERLAP` | Chunk overlap in characters | `200` |
| `RAG_MCP_BATCH_SIZE` | Embedding batch size | `200` |
| `RAG_MCP_MAX_FILE_BYTES` | Max file size to index | `50000` |
| `RAG_MCP_DEFAULT_RESULTS` | Default search result count | `5` |
| `RAG_MCP_MAX_RESULTS` | Max allowed search results | `20` |
| `RAG_MCP_SNIPPET_MAX` | Max snippet content characters | `500` |
| `RAG_MCP_INCLUDE_EXTS` | JSON array of file extensions to index | (see defaults) |
| `RAG_MCP_EXCLUDE_DIRS` | JSON array of directory names to skip | (see defaults) |

## Usage

### Starting the Server

```bash
# Stdio mode (default, for MCP clients)
pnpm start

# HTTP mode
RAG_MCP_TRANSPORT=http pnpm start
```

### MCP Client Configuration

```json
{
  "mcpServers": {
    "rag-processor": {
      "command": "node",
      "args": ["/path/to/rag-processor-mcp/dist/index.js"]
    }
  }
}
```

### Available Tools

| Tool | Description |
|------|-------------|
| `search_codebase(query, n_results?)` | Semantic search over all indexed repos. Returns ranked snippets scored by cosine similarity. |
| `list_indexed_repos()` | List all repositories currently indexed in the vector store. |
| `get_file_content(repo_name, file_path)` | Retrieve the full content of a specific file from an indexed repository. Reconstructed from stored chunks. |
| `get_repo_structure(repo_name)` | Retrieves the repository file tree. Useful for understanding project scaffolding and architecture. |

### CLI Commands

Standalone CLI commands (no MCP server needed):

```bash
# Index a repository
node dist/index.js index-repo <repo_url> [branch]

# Remove an indexed repository
node dist/index.js remove-repo <repo_name>
```

The `index-repo` and `remove-repo` tools are intentionally disabled in MCP mode for safety (require authentication to be designed). Use the CLI for those operations.

## How It Works

### Indexing Pipeline

1. **Clone/Resolve**: Resolves the repo reference — clones remote repos or uses local paths. Detects existing index and computes `git diff` for incremental updates.
2. **Scan**: Discovers code files matching indexed extensions, respecting exclude patterns and size limits.
3. **Chunk**: Initializes tree-sitter, then splits files into overlapping chunks with structural awareness.
4. **Embed**: Producer-consumer pipeline: chunks are produced and embedded in parallel batches with backpressure (`MAX_IN_FLIGHT = embedder count`).
5. **Store**: Persists chunks and vectors — incremental (insert only) or full overwrite depending on whether a prior index exists.

Supports `AbortSignal` and `onProgress` callback. Phases: `clone` → `scan` → `chunk` → `embed` → `store`.

### Query Pipeline

1. **Embed query**: The search query is embedded using the configured provider.
2. **Cosine similarity**: Compared against all stored chunk vectors.
3. **Rank & return**: Results sorted by similarity score with metadata.

## Development

### Project Structure

```
rag-processor-mcp/
├── src/
│   ├── index.ts              # Entrypoint — routes to CLI or MCP server
│   ├── cli.ts                # CLI command handler (index-repo, remove-repo)
│   ├── server.ts             # MCP server (Stdio + StreamableHTTP transports)
│   ├── tools/
│   │   ├── index.ts          # Tool registration (4 active tools)
│   │   ├── search.ts         # search_codebase
│   │   ├── list-repos.ts     # list_indexed_repos
│   │   ├── get-file-content.ts  # get_file_content
│   │   ├── get-repo-structure.ts # get_repo_structure
│   │   ├── index-repo.ts     # index_repo (disabled in MCP)
│   │   └── remove-repo.ts    # remove-repo (disabled in MCP)
│   ├── core/
│   │   ├── config.ts         # Three-layer config: defaults < file < env
│   │   ├── embedder.ts       # Embedding provider factory with concurrency pooling
│   │   ├── response.ts       # Standardized MCP response helpers
│   │   ├── rrf.ts            # Reciprocal rank fusion utilities
│   │   ├── abort-error.ts    # AbortError class for cancellation
│   │   ├── types.ts          # Shared type definitions (Chunk, StoreEntry, etc.)
│   │   ├── embed/
│   │   │   ├── provider.ts       # EmbeddingProvider interface
│   │   │   ├── local-provider.ts # Xenova Transformers (ONNX)
│   │   │   └── langchain-provider.ts # LangChain wrapper (OpenAI, Cohere)
│   │   └── store/
│   │       ├── provider.ts       # StoreProvider interface (12 methods)
│   │       ├── store.ts          # Store class wiring providers
│   │       ├── json-provider.ts  # File-based JSON vector store
│   │       ├── pg-provider.ts    # PostgreSQL + pgvector store
│   │       ├── pg-migrations.ts  # PostgreSQL schema migrations
│   │       ├── errors.ts         # Store-specific error types
│   │       └── index.ts          # Public API surface
│   └── indexing/
│       ├── index.ts          # Producer-consumer pipeline (chunk → embed → store)
│       ├── chunker.ts        # Chunk counting & splitting logic
│       ├── scanner.ts        # File system scanner (excludes, ext filter, size check)
│       ├── resolver.ts       # Git repo resolver (clone, pull, local path)
│       └── tree-sitter.ts    # Tree-sitter based structure-aware chunking
├── src/__tests__/
│   └── server.test.ts        # Integration test
├── AGENTS.md                 # Development guidelines
├── package.json
├── tsconfig.json
└── README.md
```

### Commands

| Command | Action |
|---------|--------|
| `pnpm run build` | `tsc` |
| `pnpm dev` | Build + start |
| `pnpm start` | `node dist/index.js` |
| `pnpm test` | `vitest run` |
| `pnpm run test:watch` | `vitest` (watch) |
| `pnpm run lint` | `oxlint` |
| `pnpm run lint:fix` | `oxlint --fix` |
| `pnpm run format` | `oxfmt --write src/` |
| `pnpm run format:check` | `oxfmt --check src/` |
| `pnpm run inspect` | MCP Inspector (web, localhost:5173) |
| `pnpm run inspect:cli` | MCP Inspector (terminal) |
| `pnpm exec lint-staged` | Pre-commit: oxlint + oxfmt on staged files |

### Code Conventions

- **Naming**: `kebab-case.ts` files, named exports only (no default), camelCase variables, PascalCase types/interfaces
- **Dependency direction**: `tools/` → `indexing/` → `core/` — no reverse imports
- **Tool handler structure**: Tool files follow `// --- Config ---` → `// --- Handler ---` → `// --- Registration ---` pattern with Zod schemas
- **Internal imports**: ESM `.js` extension (`import { ... } from "../core/store/index.js"`)
- **SDK imports**: from `@modelcontextprotocol/sdk/server/mcp.js`
- **Error handling**: Tool handlers return `errorResponse(message)` — never throw; fatal errors use `console.error` + `process.exit(1)`
- **Atomic JSON writes**: `.tmp.<pid>` staging then `renameSync` — no data-loss window
- **Changes to `core/`** ripple everywhere

### Testing

Tests live next to source as `*.test.ts` (7 files): `store.test.ts`, `config.test.ts`, `response.test.ts`, `scanner.test.ts`, `chunker.test.ts`, `pg-provider.test.ts`, plus integration test at `src/__tests__/server.test.ts`.

- Uses `vitest` with `globals: false` — import `describe`, `it`, `expect`, `vi` explicitly
- Store tests use `fs.mkdtempSync` temp directories with `resetConfig()` — never touch real config
- Config tests use `vi.resetModules()` + dynamic `import()` to clear cached config between cases

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Install dependencies (`pnpm install`)
4. Make your changes — follow conventions in [AGENTS.md](AGENTS.md)
5. Run lint and tests (`pnpm run lint && pnpm test`)
6. Commit — pre-commit hooks (lint-staged) run automatically
7. Push and open a Pull Request

## License

MIT — see [LICENSE](LICENSE).
