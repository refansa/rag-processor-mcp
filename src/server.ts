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

  await store.$connect();

  if (cfg.transport === "http") {
    const app = express();
    app.use(cors());

    const sessions = new Map<
      string,
      { server: McpServer; transport: StreamableHTTPServerTransport }
    >();

    app.use("/mcp", async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && sessions.has(sessionId)) {
        transport = sessions.get(sessionId)!.transport;
      } else {
        const server = new McpServer(
          { name: "rag-processor-mcp", version: "0.1.0" },
          { capabilities: { tools: {} } },
        );
        registerTools(server, store);

        const newTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            sessions.set(newSessionId, { server, transport: newTransport });
          },
          onsessionclosed: (closedSessionId) => {
            sessions.delete(closedSessionId);
          },
        });

        await server.connect(newTransport);
        transport = newTransport;
      }

      try {
        await transport.handleRequest(req, res);
      } catch (err) {
        console.error("[rag-processor-mcp] Transport error:", err);
        if (!res.headersSent) {
          res.status(500).send("Internal Error");
        }
      }
    });

    app.listen(cfg.port, () => {
      console.error(`[rag-processor-mcp] Server running on http://localhost:${cfg.port}/mcp`);
    });
  } else {
    const server = new McpServer(
      { name: "rag-processor-mcp", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );
    registerTools(server, store);

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[rag-processor-mcp] Server running on stdio");

    transport.onclose = async () => {
      await store.$disconnect();
      process.exit(0);
    };
  }
}
