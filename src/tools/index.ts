/**
 * Tool registration barrel — wire all tools to the server.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTool } from "./search.js";
import { registerIndexRepoTool } from "./index-repo.js";
import { registerListReposTool } from "./list-repos.js";

export function registerTools(server: McpServer): void {
  registerSearchTool(server);
  registerIndexRepoTool(server);
  registerListReposTool(server);
}
