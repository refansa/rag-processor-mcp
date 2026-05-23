# rag-processor-mcp

MCP server for **semantic search over code repositories**. Index any Git repo — local or remote — then query it by meaning, not keywords.

## Architecture

Domain-based directory structure under `src/`:

```
src/
├── server.ts              # Entry point: McpServer + StdioServerTransport
├── core/                  # Shared primitives — no imports from indexing/ or tools/
│   ├── embedder.ts        #   all-MiniLM-L6-v2 singleton (Xenova Transformers)
│   ├── store.ts           #   JSON-backed vector store with cosine similarity
│   ├── response.ts        #   MCP response helpers (textResponse, errorResponse)
│   └── types.ts           #   Shared TypeScript types
├── indexing/              # Pipeline: resolve → scan → chunk → embed → store
│   ├── index.ts           #   Orchestrator (indexRepo function)
│   ├── resolver.ts        #   Git clone/pull or local path resolution
│   ├── scanner.ts         #   File walker with include/exclude rules
│   └── chunker.ts         #   Overlapping text chunker (1K chars, 200 overlap)
└── tools/                 # MCP tool handlers — one file per tool
    ├── index.ts           #   Barrel: registerTools()
    ├── search.ts          #   search_codebase tool
    ├── index-repo.ts      #   index_repo tool
    ├── list-repos.ts      #   list_indexed_repos tool
    ├── get-file-content.ts #   get_file_content tool
    └── remove-repo.ts     #   remove_repo tool
```

### Dependency direction

`tools/` → `indexing/` → `core/`

No reverse imports. `core/` knows nothing about indexing or tools. `indexing/` imports only from `core/`.

## Technology stack

| Layer | Choice |
|---|---|
| Runtime | Node 22 (ESM) |
| Language | TypeScript 5.5, strict mode |
| Transport | stdio (StdioServerTransport) |
| SDK | @modelcontextprotocol/sdk v1 |
| Embeddings | all-MiniLM-L6-v2 via @xenova/transformers (in-process, no external API) |
| Git | simple-git |
| Linter | oxlint (correctness+suspicious=error, perf+style=warn) |
| Formatter | oxfmt |
| Bundler | tsc only (no bundler — native Node ESM) |

## Conventions

### Naming

- **Files**: `kebab-case.ts` — always. E.g. `index-repo.ts`, `list-repos.ts`.
- **Exports**: Named exports only. No default exports anywhere.
- **Tool registration functions**: `register*Tool` — e.g. `registerSearchTool`, `registerIndexRepoTool`.
- **Types/interfaces**: PascalCase (`SearchResult`, `StoreEntry`, `FileInfo`).
- **Variables/functions**: camelCase.

### File structure (tools)

Every tool handler file follows the same structure:

1. Imports (stdlib, third-party, internal — grouped and ordered)
2. `// --- Config ---` — DESCRIPTION string + INPUT_SCHEMA
3. `// --- Handler ---` — async handler function
4. `// --- Registration ---` — `export function register*Tool(server)`

### Import style

- Internal imports use `.js` extension (ESM convention): `import { ... } from "../core/store/index/index.js"`
- Zod used for input schema definitions in tool handlers
- `@modelcontextprotocol/sdk` imports from `.../mcp.js` subpath

### Error handling

- Fatal errors in `server.ts`: log to stderr, `process.exit(1)`
- Tool-level errors: return `errorResponse(message)` — never throw
- Writes use atomic write pattern (write to `.tmp.<pid>`, then `renameSync`)

## Key patterns

### Embedder singleton

```ts
// core/embedder.ts — loaded once, shared across application
const embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
```

### Config system

```ts
// src/core/config.ts — three-layer priority: hardcoded < config file < env var
const cfg = getConfig();
// cfg.dataDir, cfg.reposDir, cfg.embedderModel, cfg.chunkSize, etc.
```

All hardcoded constants are in `src/core/config.ts`. Override via `~/.rag-mcp-server/config.json` or `RAG_MCP_*` env vars.

### Atomic replace — no data-loss window

```ts
// core/store/index.ts — single write removes old + adds new entries
replaceRepoEntries(repoName, newEntries);
// NOT: removeRepo() + addEntries() — that's two writes with a loss window
```

### Index pipeline with progress

```ts
// indexing/index.ts — accepts optional signal + onProgress
await indexRepo("https://github.com/user/repo.git", {
  signal: extra.signal,
  onProgress: (p) => {
    // p.phase: "clone" | "scan" | "chunk" | "embed" | "store"
    // p.current, p.total, p.message
  },
});
```

### MCP progress notifications (long-running tools)

Tool handlers that run longer than a few seconds should report progress:

```ts
// tools/index-repo.ts
async function handleIndexRepo(args, extra) {
  const progressToken = extra._meta?.progressToken;
  if (progressToken !== undefined) {
    await extra.sendNotification({
      method: "notifications/progress",
      params: { progressToken, progress, total, message },
    } as ServerNotification);
  }
}
```

Check `extra.signal.aborted` periodically and throw if cancelled.

### Atomic JSON persistence

```ts
// core/store/index.ts — write to temp file, then rename
const tmp = filePath + ".tmp." + process.pid;
fs.writeFileSync(tmp, data, "utf-8");
fs.renameSync(tmp, filePath);
```

### Batch embedding

Embeddings are generated in batches of 50 to avoid OOM on large repos. Progress logged every 200 chunks.

### Cosine similarity

Brute-force (O(n) per query) over all stored entries. Simple for small-to-medium datasets. Not designed for million-scale corpora.

## Commands

```bash
npm run build        # tsc
npm run dev          # build + run
npm start            # run compiled output
npm test             # vitest run (single run)
npm run test:watch   # vitest (watch mode)
npm run lint         # oxlint
npm run lint:fix     # oxlint --fix
npm run format       # oxfmt --write src/
npm run format:check # oxfmt --check src/
npm run inspect      # MCP Inspector (web UI at localhost:5173)
npm run inspect:cli  # MCP Inspector (terminal mode)
```

## Testing

Tests live next to source files as `*.test.ts`. Config in `vitest.config.ts`.

```bash
npm test             # run all tests once
npm run test:watch   # watch mode for TDD
```

### Conventions

- **Core logic** gets unit tests (config, store, chunker, scanner, response).
- **Integration tests** live in `src/__tests__/server.test.ts` — start the server over stdio and verify tool registration/responses.
- **Store tests** use temp directories via `RAG_MCP_DATA_DIR` env var + `resetConfig()` to avoid polluting the real data dir.
- **Config tests** reset env vars between tests with `vi.resetModules()` + dynamic `import()`.
- No globals — import `describe`, `it`, `expect`, `vi` explicitly from vitest.

## Data flow

```
index_repo("https://github.com/user/repo.git")
  → resolver.ts: clone or pull to ~/.rag-mcp-server/repos/
  → scanner.ts: walk files (skip excluded dirs >50KB, non-code exts)
  → chunker.ts: split into overlapping 1K-char chunks
  → embedder.ts: all-MiniLM-L6-v2 batch embedding
  → store.ts: atomic JSON write to ~/.rag-mcp-server/entries.json

search_codebase("logging pattern", n_results=5)
  → embedder.ts: embed query
  → store.ts: cosine similarity scan over all entries
  → return top-n results
```

## Data location

All persistent data under `~/.rag-mcp-server/`:
- `entries.json` — vector store (id, text, embedding, metadata)
- `repos.json` — indexed repo registry
- `repos/` — cloned remote repositories

## MCP tools

| Tool | Input | Output |
|---|---|---|
| `index_repo` | `repo_url: string` | `{ status, repo, files, chunks }` |
| `search_codebase` | `query: string`, `n_results?: number` | `{ results, total }` |
| `list_indexed_repos` | — | `{ repos, total }` |
| `get_file_content` | `repo_name: string`, `file_path: string` | `{ repo, file, ext, content, totalChunks }` |
| `remove_repo` | `repo_name: string` | `{ status, repo }` |

## AGENTS.md conventions for this repo

If you're an AI agent working on this codebase:

- **Stay in the domain pattern.** New features go in the right directory: tools in `tools/`, pipeline logic in `indexing/`, shared primitives in `core/`.
- **One concern per file.** If a tool handler gets complex, extract the business logic into `indexing/` or `core/`, not into the tool file.
- **Use the existing patterns.** New tool? Copy `src/tools/search.ts` structure. New store operation? Extend `src/core/store/index.ts`.
- **No default exports.** Named exports everywhere.
- **ESM `.js` extension** on all internal imports.
- **Run `npm run lint:fix` and `npm run format`** before committing.
- **Changes to `core/` ripple everywhere** — think twice before adding dependencies there.
- **Vector store is JSON-backed, not a DB.** Don't add SQLite or other DBs without discussion — the simplicity is intentional.
