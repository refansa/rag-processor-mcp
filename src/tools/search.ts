import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getEmbedder } from "../core/embedder.js";
import { errorResponse, textResponse } from "../core/response.js";
import { getConfig } from "../core/config.js";
import type { EntryStore } from "../core/store/index.js";

const cfg = getConfig();

// --- Config ---

const DESCRIPTION =
  "Semantic search over all indexed code repositories. " +
  "Finds relevant code snippets, utility patterns, project structures, " +
  "and conventions by meaning, not keywords.";

const INPUT_SCHEMA = z.object({
  n_results: z
    .number()
    .int()
    .min(1)
    .max(cfg.maxResults)
    .optional()
    .default(cfg.defaultResults)
    .describe(
      `Number of results to return (default: ${cfg.defaultResults}, max: ${cfg.maxResults})`,
    ),
  query: z
    .string()
    .describe(
      'Natural language query — e.g. "logging utility", "project structure", ' +
        '"auth middleware pattern", "how do we handle config"',
    ),
});

// --- Handler ---

interface SearchArgs {
  query: string;
  n_results: number;
}

function handleSearch(entryStore: EntryStore) {
  return async (
    { query, n_results }: SearchArgs,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  ) => {
    try {
      const embedder = await getEmbedder();
      const embeddingRows = await embedder.embed([query], extra.signal);
      const queryEmbedding: number[] = embeddingRows[0];
      const results = await entryStore.searchSimilar(query, queryEmbedding, n_results);
      return textResponse({ results, total: results.length });
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : String(error));
    }
  };
}

// --- Registration ---

export function registerSearchTool(server: McpServer, entryStore: EntryStore): void {
  server.registerTool(
    "search_codebase",
    {
      description: DESCRIPTION,
      inputSchema: INPUT_SCHEMA as unknown as AnySchema,
    },
    handleSearch(entryStore),
  );
}
