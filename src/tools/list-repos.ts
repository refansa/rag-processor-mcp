import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RepoStore } from "../core/store/index.js";
import { textResponse } from "../core/response.js";

// --- Config ---

const DESCRIPTION = "List all repositories currently indexed in the vector store.";

// --- Handler ---

function handleListRepos(repoStore: RepoStore) {
  return async () => {
    const repos = await repoStore.listAll();
    return textResponse({ repos, total: repos.length });
  };
}

// --- Registration ---

export function registerListReposTool(server: McpServer, repoStore: RepoStore): void {
  server.registerTool(
    "list_indexed_repos",
    {
      description: DESCRIPTION,
      inputSchema: {},
    },
    handleListRepos(repoStore),
  );
}
