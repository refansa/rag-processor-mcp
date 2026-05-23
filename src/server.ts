/**
 * Rag-processor-mcp — MCP server for semantic code search.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Store } from "./core/store/index.js";
import { registerTools } from "./tools/index.js";
import { getConfig } from "./core/config.js";

const cfg = getConfig();

const store = new Store({
  poolSize: cfg.store.poolSize,
  provider: cfg.store.provider,
  url: cfg.store.url,
});

const server = new McpServer(
  { name: "rag-processor-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

registerTools(server, store);

async function main() {
  await store.$connect();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[rag-processor-mcp] Server running on stdio");
}

main().catch((error) => {
  console.error("[rag-processor-mcp] Fatal error:", error);
  process.exit(1);
});
