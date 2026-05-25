import { runServer } from "./server.js";
import { runCli } from "./cli.js";
import { resetEmbedders } from "./core/embedder.js";

async function main() {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    await runCli(args);
  } else {
    await runServer();
  }
}

main().catch((error) => {
  console.error("[rag-processor-mcp] Fatal error:", error);
  process.exit(1);
});

// Global process handlers
process.on("uncaughtException", (error) => {
  console.error("[rag-processor-mcp] Uncaught exception:", error);
});
process.on("unhandledRejection", (reason) => {
  console.error("[rag-processor-mcp] Unhandled rejection:", reason);
});

async function shutdown() {
  await resetEmbedders();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
