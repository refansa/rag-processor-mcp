import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import { errorResponse, textResponse } from "../core/response.js";
import type { Store } from "../core/store/index.js";

// --- Config ---

const DESCRIPTION =
  "Remove an indexed repository from the vector store. " +
  "Deletes all stored embeddings, chunks, and repo metadata for the given repo.";

const INPUT_SCHEMA = z.object({
  repo_name: z.string().describe("Name of the indexed repository to remove (e.g. 'gyat')"),
});

// --- Handler ---

interface RemoveRepoArgs {
  repo_name: string;
}

function handleRemoveRepo(store: Store) {
  return async ({ repo_name }: RemoveRepoArgs) => {
    if (!repo_name) {
      return errorResponse("repo_name is required");
    }

    await store.repo.removeOne(repo_name);

    return textResponse({ repo: repo_name, status: "ok" });
  };
}

// --- Registration ---

export function registerRemoveRepoTool(server: McpServer, store: Store): void {
  server.registerTool(
    "remove_repo",
    {
      description: DESCRIPTION,
      inputSchema: INPUT_SCHEMA as unknown as AnySchema,
    },
    handleRemoveRepo(store),
  );
}
