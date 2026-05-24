import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Store } from "../core/store/index.js";
import { AbortError } from "../core/abort-error.js";
import { indexRepo } from "../indexing/index.js";
import type { IndexProgress } from "../indexing/index.js";
import { errorResponse, textResponse } from "../core/response.js";

// --- Config ---

const DESCRIPTION =
  "Index a code repository for semantic search. " +
  "Accepts a Git URL (https:// or git@) or a local filesystem path. " +
  "Clones remote repos into a local cache, then scans, chunks, and embeds the code.";

const INPUT_SCHEMA = z.object({
  repo_url: z
    .string()
    .describe("Git URL (e.g. https://github.com/user/repo.git) or local filesystem path"),
});

// --- Handler ---

interface IndexRepoArgs {
  repo_url: string;
}

function handleIndexRepo(store: Store) {
  return async (
    { repo_url }: IndexRepoArgs,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  ) => {
    if (!repo_url) {
      return errorResponse("repo_url is required");
    }

    const progressToken = extra._meta?.progressToken;

    function onProgress(p: IndexProgress) {
      if (progressToken !== undefined) {
        extra
          .sendNotification({
            method: "notifications/progress",
            params: {
              message: p.message,
              progress: p.current,
              progressToken,
              total: p.total,
            },
          } as ServerNotification)
          .catch(() => {
            // Best-effort — client may not support progress
          });
      }
    }

    try {
      const result = await indexRepo(repo_url, store, {
        onProgress,
        signal: extra.signal,
      });

      return textResponse({
        chunks: result.chunkCount,
        files: result.fileCount,
        message: `Indexed ${result.fileCount} files (${result.chunkCount} chunks) from ${result.repoName}`,
        repo: result.repoName,
        status: "ok",
      });
    } catch (error) {
      if (error instanceof AbortError) {
        return errorResponse("Indexing was cancelled");
      }
      return errorResponse(error instanceof Error ? error.message : String(error));
    }
  };
}

// --- Registration ---

export function registerIndexRepoTool(server: McpServer, store: Store): void {
  server.registerTool(
    "index_repo",
    {
      description: DESCRIPTION,
      inputSchema: INPUT_SCHEMA as unknown as AnySchema,
    },
    handleIndexRepo(store),
  );
}
