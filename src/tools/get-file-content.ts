import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import { errorResponse, textResponse } from "../core/response.js";
import type { EntryStore } from "../core/store/index.js";

// --- Config ---

const DESCRIPTION =
  "Retrieve the full content of a specific file from an indexed repository. " +
  "The file content is reconstructed from stored chunks. " +
  "Use this when search_codebase excerpts aren't enough — " +
  "get the complete file to see full context, imports, or structure.";

const INPUT_SCHEMA = z.object({
  repo_name: z.string().describe("Name of the indexed repository (e.g. 'gyat')"),
  file_path: z
    .string()
    .describe("Path to the file within the repository (e.g. 'cmd/sync.go', 'README.md')"),
});

// --- Handler ---

interface GetFileContentArgs {
  repo_name: string;
  file_path: string;
}

function handleGetFileContent(entryStore: EntryStore) {
  return async ({ repo_name, file_path }: GetFileContentArgs) => {
    if (!repo_name) {
      return errorResponse("repo_name is required");
    }
    if (!file_path) {
      return errorResponse("file_path is required");
    }

    const result = await entryStore.getFileContent(repo_name, file_path);
    if (!result) {
      return errorResponse(`File '${file_path}' not found in repository '${repo_name}'`);
    }

    return textResponse(result);
  };
}

// --- Registration ---

export function registerGetFileContentTool(server: McpServer, entryStore: EntryStore): void {
  server.registerTool(
    "get_file_content",
    {
      description: DESCRIPTION,
      inputSchema: INPUT_SCHEMA as unknown as AnySchema,
    },
    handleGetFileContent(entryStore),
  );
}
