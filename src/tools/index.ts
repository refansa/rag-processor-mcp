import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Store } from "../core/store/index.js";
import { registerSearchTool } from "./search.js";
// import { registerIndexRepoTool } from "./index-repo.js";
import { registerListReposTool } from "./list-repos.js";
import { registerGetFileContentTool } from "./get-file-content.js";
// import { registerRemoveRepoTool } from "./remove-repo.js";

export function registerTools(server: McpServer, store: Store): void {
  registerSearchTool(server, store.entry);
  registerListReposTool(server, store.repo);
  registerGetFileContentTool(server, store.entry);

  // TODO(refan): support authentication for destructive tools.
  //
  // Disable indexing and removal of repositories through MCP for now.
  // We might uncomment this again later on with an authentication implementation.
  //
  // registerIndexRepoTool(server, store);
  // registerRemoveRepoTool(server, store);
}
