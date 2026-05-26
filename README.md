# rag-processor-mcp

MCP server for **semantic search over code repositories**. Index any Git repo — local or remote — then query it by meaning, not keywords.

## Quick start

```bash
npm install
npm run build
```

### Starting the Server

By default, the server runs in Stdio mode for MCP:

```bash
npm start
```

### CLI Commands

You can also run standalone CLI commands without starting the MCP server:

```bash
# Index a repository manually
node dist/index.js index-repo <repo_url> [branch]

# Remove an indexed repository
node dist/index.js remove-repo <repo_name>
```

## Tools

| Tool | Description |
|---|---|
| `search_codebase(query, n_results?)` | Semantic search over all indexed repos. Returns ranked snippets scored by cosine similarity. |
| `index_repo(repo_url)` | Index a repo by Git URL (`https://` or `git@`) or local filesystem path. Clones remote repos into a local cache, then scans, chunks, and embeds. |
| `list_indexed_repos()` | Show which repos are currently in the vector store. |

### Example

```
query: "logging utility pattern"
→ results sorted by relevance, each with repo, file path, score, and content snippet
```

## How it works

1. **`index_repo`** clones (or pulls) a repo, scans code files, splits them into overlapping chunks, embeds each chunk, and stores the vectors.
2. **`search_codebase`** embeds your query and finds the nearest chunks by cosine similarity.

### Backends & Configuration

The server supports multiple backends for embeddings and storage via environment variables:

**Embedding Providers:**
- **Local (Default):** `all-MiniLM-L6-v2` via Xenova Transformers (runs locally in-process)
- **OpenAI:** Uses `text-embedding-3-small` (or configured model)
- **Cohere:** Uses `embed-english-v3.0` (or configured model)

**Vector Storage:**
- **JSON (Default):** Stores vectors in local JSON files
- **PostgreSQL:** Uses `pgvector` for scalable storage (requires `RAG_MCP_STORE_PROVIDER=postgresql`)

### Indexed file types

`.py .ts .tsx .js .jsx .rs .go .java .kt .swift .md .yaml .yml .toml .json .css .scss .html`

Directories like `node_modules`, `.git`, `dist`, `build`, `.venv` are skipped automatically. Files over 50 KB are ignored.

### Data location

Vector store and cloned repos live at `~/.rag-mcp-server/`.

## Development

```bash
# Build
npm run build

# Lint (oxlint)
npm run lint
npm run lint:fix

# Format (oxfmt)
npm run format
npm run format:check

# Inspector (web UI at http://localhost:5173)
npm run inspect

# Inspector (terminal mode)
npm run inspect:cli
```
