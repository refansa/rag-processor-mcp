import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts"],
    env: {
      RAG_MCP_CONFIG: "/tmp/rag-test-no-config.json",
    },
  },
});
