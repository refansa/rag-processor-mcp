/**
 * Rag-processor-mcp — MCP server for semantic code search.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index.js";

const server = new McpServer(
  { name: "rag-processor-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

registerTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[rag-processor-mcp] Server running on stdio");
}

main().catch((error) => {
  console.error("[rag-processor-mcp] Fatal error:", error);
  process.exit(1);
});
