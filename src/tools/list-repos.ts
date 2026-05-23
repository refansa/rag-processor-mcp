/**
 * List_indexed_repos tool: show which repos are in the vector store.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getIndexedRepos } from "../core/store.js";
import { textResponse } from "../core/response.js";

// --- Config ---

const DESCRIPTION = "List all repositories currently indexed in the vector store.";

// --- Handler ---

async function handleListRepos() {
  const repos = getIndexedRepos();
  return textResponse({ repos, total: repos.length });
}

// --- Registration ---

export function registerListReposTool(server: McpServer): void {
  server.registerTool(
    "list_indexed_repos",
    {
      description: DESCRIPTION,
      inputSchema: {},
    },
    handleListRepos,
  );
}
