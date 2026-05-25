/**
 * Rag-processor-mcp — MCP server for semantic code search.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { Store } from "./core/store/index.js";
import { registerTools } from "./tools/index.js";
import { getConfig } from "./core/config.js";

export async function runServer() {
  const cfg = getConfig();

  const store = new Store({
    embeddingDimension: cfg.store.embeddingDimension,
    poolSize: cfg.store.poolSize,
    provider: cfg.store.provider,
    url: cfg.store.url,
  });

  const server = new McpServer(
    { name: "rag-processor-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  registerTools(server, store);

  await store.$connect();

  if (cfg.transport === "http") {
    const app = express();
    app.use(cors());
    // Use express.json() if you want express to parse JSON,
    // but handleRequest can also parse it if you pass req directly.

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    await server.connect(transport);

    app.use("/mcp", (req, res) => {
      transport.handleRequest(req, res).catch((err) => {
        console.error("[rag-processor-mcp] Transport error:", err);
        if (!res.headersSent) {
          res.status(500).send("Internal Error");
        }
      });
    });

    app.listen(cfg.port, () => {
      console.error(`[rag-processor-mcp] Server running on http://localhost:${cfg.port}/mcp`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[rag-processor-mcp] Server running on stdio");

    transport.onclose = async () => {
      await store.$disconnect();
      process.exit(0);
    };
  }
}
