import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import type { RepoStore } from "../core/store/index.js";
import { errorResponse, textResponse } from "../core/response.js";

// --- Config ---

const DESCRIPTION = "List all repositories currently indexed in the vector store.";

// --- Handler ---

function handleListRepos(repoStore: RepoStore) {
  return async () => {
    try {
      const repos = await repoStore.listAll();
      return textResponse({ repos, total: repos.length });
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : String(error));
    }
  };
}

// --- Registration ---

export function registerListReposTool(server: McpServer, repoStore: RepoStore): void {
  server.registerTool(
    "list_indexed_repos",
    {
      description: DESCRIPTION,
      inputSchema: z.object({}) as unknown as AnySchema,
    },
    handleListRepos(repoStore),
  );
}
