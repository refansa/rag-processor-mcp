# rag-processor-mcp

MCP server for **semantic search over code repositories**. Index any Git repo — local or remote — then query it by meaning, not keywords.

## Quick start

```bash
npm install
npm run build
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

1. **`index_repo`** clones (or pulls) a repo, scans code files, splits them into overlapping chunks, embeds each chunk using `all-MiniLM-L6-v2` (via Xenova Transformers, runs locally in-process), and stores the vectors as JSON.
2. **`search_codebase`** embeds your query with the same model and finds the nearest chunks by cosine similarity.

### Indexed file types

`.py .ts .tsx .js .jsx .rs .go .java .kt .swift .md .yaml .yml .toml .json .css .scss .html`

Directories like `node_modules`, `.git`, `dist`, `build`, `.venv` are skipped automatically. Files over 50 KB are ignored.

### Data location

Vector store and cloned repos live at `~/.hermes/rag-mcp-server/`.

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
