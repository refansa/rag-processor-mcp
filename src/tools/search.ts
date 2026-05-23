import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import { getEmbedder } from "../core/embedder.js";
import { textResponse } from "../core/response.js";
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
  return async ({ query, n_results }: SearchArgs) => {
    const embedder = await getEmbedder();
    const output = await embedder([query], {
      normalize: true,
      pooling: "mean",
    });
    const queryEmbedding: number[] = output.tolist()[0];
    const results = await entryStore.searchSimilar(queryEmbedding, { take: n_results });
    return textResponse({ results, total: results.length });
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
