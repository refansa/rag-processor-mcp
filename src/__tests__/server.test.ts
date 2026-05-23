import { spawn } from "node:child_process";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const SERVER = path.resolve(process.cwd(), "dist/server.js");

/**
 * Spawn the MCP server, wait for it to be ready, send a request,
 * then close stdin and return the parsed JSON response.
 */
function mcpCall(method: string, params?: Record<string, unknown>): Promise<unknown> {
  const request = JSON.stringify({
    id: 1,
    jsonrpc: "2.0",
    method,
    ...(params ? { params } : {}),
  });

  return new Promise<unknown>((resolve, reject) => {
    const proc = spawn(process.execPath, [SERVER], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];

    // Collect stdout data
    proc.stdout!.on("data", (data: Buffer) => {
      chunks.push(data);
    });

    // When stdin closes, the server will exit — parse what we got
    proc.stdout!.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new SyntaxError(`Invalid JSON response: ${raw.slice(0, 200)}`));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });

    // Wait for the server ready message on stderr, then send the request
    proc.stderr!.once("data", () => {
      // Server is ready — write the request and close stdin
      proc.stdin!.write(`${request}\n`);
      proc.stdin!.end();
    });

    // Safety timeout
    setTimeout(() => {
      proc.kill();
      reject(new Error("mcpCall timed out after 10s"));
    }, 10_000);
  });
}

function toolCall(name: string, args?: Record<string, unknown>): Promise<unknown> {
  return mcpCall("tools/call", { arguments: args ?? {}, name });
}

describe("MCP server (integration)", () => {
  let toolsList: string[];

  beforeAll(async () => {
    const response = (await mcpCall("tools/list")) as {
      result: { tools: { name: string }[] };
    };
    toolsList = response.result.tools.map((t) => t.name).toSorted();
  });

  it("registers all 3 tools", () => {
    expect(toolsList).toEqual(["index_repo", "list_indexed_repos", "search_codebase"]);
  });

  it("starts with no indexed repos", async () => {
    const response = (await toolCall("list_indexed_repos")) as {
      result: { content: { type: string; text: string }[] };
    };
    expect(response.result.content[0].type).toBe("text");
    const data = JSON.parse(response.result.content[0].text);
    expect(data.total).toBe(0);
    expect(data.repos).toEqual([]);
  });

  it("rejects unknown tools with an error", async () => {
    const response = (await toolCall("nonexistent_tool")) as {
      error?: { message: string };
      result?: { isError: boolean; content: { text: string }[] };
    };
    expect(response.error ?? response.result?.isError).toBeTruthy();
  });
});
