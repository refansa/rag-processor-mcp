# rag-processor-mcp

MCP server for semantic search over code repositories — index any Git repo, query by meaning.

## Key facts

**Dependency direction:** `tools/` → `indexing/` → `core/` — no reverse imports.

**Entrypoint:** `src/server.ts` — creates `McpServer` + `StdioServerTransport`. Fatal errors → `process.exit(1)`.

## Store backends (`src/core/store/`)

Two implementations of `StoreProvider` (12 methods in `provider.ts`):

| Provider | File | Selection |
|---|---|---|
| JSON (default) | `json-provider.ts` | `new JsonProvider(url)` |
| PostgreSQL | `pg-provider.ts` | `new PgProvider(url, poolSize)` |

The `Store` class in `store.ts` wires them: `new Store({ provider: "json" | "postgresql", url, poolSize, embeddingDimension })`. Public API surfaces are `store.entry` (`EntryStore`) and `store.repo` (`RepoStore`).

**PgProvider gaps (unwritten):** zero tests, `removeRepoEntries` doesn't update `chunk_count`, no pool error handler, `getFileEntries` returns `embedding: []`.

## Embedder backends (`src/core/embed/`)

Three providers via `EmbeddingProvider` interface (single method: `embed(texts: string[]): Promise<number[][]>`):

| Provider | Class | LangChain-based |
|---|---|---|
| local (ONNX) | `LocalProvider` | No |
| openai | `LCEmbeddingProvider` wrapping `OpenAIEmbeddings` | Yes |
| cohere | `LCEmbeddingProvider` wrapping `CohereEmbeddings` | Yes |

Wired in `src/core/embedder.ts` with concurrency pooling — `getEmbedders()` returns N instances for parallel embedding. Config-driven via `cfg.embedder.{provider, model, apiKey, baseUrl, concurrency}`.

To add a new provider:
- **LangChain-supported:** install the package, add `case` in `createLC()` → gets `LCEmbeddingProvider` for free
- **Custom:** implement `EmbeddingProvider`, add branch in `getEmbedders()`

## Config (`src/core/config.ts`)

Three-layer priority: hardcoded defaults < `~/.rag-mcp-server/config.json` < `RAG_MCP_*` env vars. Deep-merge for nested `store` and `embedder` objects. Paths normalized to forward slashes.

Notable env vars: `RAG_MCP_DATA_DIR`, `RAG_MCP_STORE_PROVIDER`, `RAG_MCP_STORE_URL`, `RAG_MCP_EMBEDDING_DIMENSION`, `RAG_MCP_EMBED_PROVIDER`, `RAG_MCP_MODEL` / `RAG_MCP_EMBED_MODEL` (latter wins), `RAG_MCP_EMBED_API_KEY`, `RAG_MCP_EMBED_BASE_URL`.

Key defaults: `chunkSize: 1000`, `chunkOverlap: 200`, `embeddingBatchSize: 200`, `maxFileBytes: 50_000`, `embedder.concurrency: max(1, cpus-1)`, `store.embeddingDimension: 384`.

## Index pipeline (`src/indexing/index.ts`)

Producer-consumer pattern: chunk files (producer) → embed batches (consumer) — run concurrently via `Promise.all`. Batching via shared buffer with backpressure (`MAX_IN_FLIGHT = embedders.length`). Accepts `AbortSignal` + `onProgress` callback. Phases: `clone` → `scan` → `chunk` → `embed` → `store`.

## Commands

| Command | Action |
|---|---|
| `pnpm run build` | `tsc` |
| `pnpm dev` | `tsc && node dist/server.js` |
| `pnpm start` | `node dist/server.js` |
| `pnpm test` | `vitest run` |
| `pnpm run test:watch` | `vitest` (watch) |
| `pnpm run lint` | `oxlint` |
| `pnpm run lint:fix` | `oxlint --fix` |
| `pnpm run format` | `oxfmt --write src/` |
| `pnpm run format:check` | `oxfmt --check src/` |
| `pnpm run inspect` | MCP Inspector (web, localhost:5173) |
| `pnpm run inspect:cli` | MCP Inspector (terminal) |
| `pnpm exec lint-staged` | Pre-commit: `oxlint --fix` + `oxfmt --write` on staged `*.{ts,tsx,js,jsx}` |

## Conventions

- **Naming:** `kebab-case.ts` files, named exports only (no default), camelCase variables, PascalCase types/interfaces
- **Tool handler structure:** `// --- Config ---` (DESCRIPTION + INPUT_SCHEMA via Zod), `// --- Handler ---`, `// --- Registration ---` (`export function register*Tool(server, store)`)
- **Internal imports:** ESM `.js` extension (`import { ... } from "../core/store/index.js"`)
- **SDK imports:** from `@modelcontextprotocol/sdk/server/mcp.js`
- **Error handling:** tool handlers return `errorResponse(message)` — never throw; fatal → `console.error` + `process.exit(1)`
- **Atomic JSON writes:** `.tmp.<pid>` file then `renameSync` (no data-loss window)
- **Changes to `core/`** ripple everywhere

## Testing

- `vitest` with `globals: false` — import `describe`, `it`, `expect`, `vi` explicitly
- Tests live next to source as `*.test.ts` (6 files), integration test in `src/__tests__/server.test.ts`
- **Store tests:** use `RAG_MCP_DATA_DIR` pointing to `fs.mkdtempSync` dir + `resetConfig()` — never touch real `~/.rag-mcp-server/`
- **Config tests:** `vi.resetModules()` + dynamic `import()` to clear cached config between cases
- **PgProvider has zero tests** — JSON provider only
