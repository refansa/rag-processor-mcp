import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Store } from "../core/store/index.js";
import { registerSearchTool } from "./search.js";
import { registerIndexRepoTool } from "./index-repo.js";
import { registerListReposTool } from "./list-repos.js";

export function registerTools(server: McpServer, store: Store): void {
  registerSearchTool(server, store.entry);
  registerIndexRepoTool(server, store);
  registerListReposTool(server, store.repo);
}
