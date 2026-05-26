import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import type { EntryStore } from "../core/store/index.js";
import { errorResponse, textResponse } from "../core/response.js";

// --- Config ---

const DESCRIPTION =
  "Retrieves the repository structure (file tree) of an indexed repository. " +
  "Useful for understanding the scaffolding, architecture, and available files in a project.";

const INPUT_SCHEMA = z.object({
  repo_name: z.string().describe("Name of the indexed repository (e.g. 'my-app')"),
});

// --- Helper ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function printTree(node: any, prefix = ""): string[] {
  const keys = Object.keys(node).toSorted();
  const lines: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const isLast = i === keys.length - 1;
    const marker = isLast ? "└── " : "├── ";
    lines.push(`${prefix}${marker}${key}`);

    const childPrefix = prefix + (isLast ? "    " : "│   ");
    lines.push(...printTree(node[key], childPrefix));
  }
  return lines;
}

function buildAsciiTree(paths: string[]): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const root: any = {};
  for (const p of paths) {
    const parts = p.split("/");
    let current = root;
    for (const part of parts) {
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part];
    }
  }

  return printTree(root).join("\n");
}

// --- Handler ---

interface GetRepoStructureArgs {
  repo_name: string;
}

function handleGetRepoStructure(entryStore: EntryStore) {
  return async ({ repo_name }: GetRepoStructureArgs) => {
    if (!repo_name) {
      return errorResponse("repo_name is required");
    }

    try {
      const files = await entryStore.getRepoFiles(repo_name);

      if (files.length === 0) {
        return errorResponse(`No files found for repository '${repo_name}'.`);
      }

      const treeStr = buildAsciiTree(files);

      return textResponse({
        repo: repo_name,
        total_files: files.length,
        tree: treeStr,
      });
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : String(error));
    }
  };
}

// --- Registration ---

export function registerGetRepoStructureTool(server: McpServer, entryStore: EntryStore): void {
  server.registerTool(
    "get_repo_structure",
    {
      description: DESCRIPTION,
      inputSchema: INPUT_SCHEMA as unknown as AnySchema,
    },
    handleGetRepoStructure(entryStore),
  );
}
