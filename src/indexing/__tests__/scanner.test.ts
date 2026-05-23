import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpDir: string;

beforeEach(() => {
  vi.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rag-scanner-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { force: true, recursive: true });
});

function write(relPath: string, content: string) {
  const full = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

describe("scanFiles", () => {
  it("finds supported file types", async () => {
    write("src/main.ts", "console.log('hello');");
    write("src/lib.py", "print('hello')");
    write("README.md", "# Docs");

    const { scanFiles } = await import("../scanner.js");
    const files = scanFiles(tmpDir);

    expect(files).toHaveLength(3);
    const names = files.map((f) => f.path).toSorted();
    expect(names).toEqual(["README.md", "src/lib.py", "src/main.ts"]);
  });

  it("skips excluded directories", async () => {
    write("src/main.ts", "console.log('hello');");
    write("node_modules/pkg/index.js", "module.exports = {};");
    write("dist/bundle.js", "/* build output */");
    write(".git/HEAD", "ref: refs/heads/main");

    const { scanFiles } = await import("../scanner.js");
    const files = scanFiles(tmpDir);

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/main.ts");
  });

  it("skips unsupported file extensions", async () => {
    write("src/main.ts", "ok");
    write("src/image.png", "binary");
    write("src/data.bin", "more binary");

    const { scanFiles } = await import("../scanner.js");
    const files = scanFiles(tmpDir);

    expect(files).toHaveLength(1);
    expect(files[0].ext).toBe(".ts");
  });

  it("skips files larger than maxFileBytes", async () => {
    write("small.ts", "// small");
    // Override max bytes to 10
    process.env.RAG_MCP_MAX_FILE_BYTES = "10";
    vi.resetModules();
    write("large.ts", "x".repeat(100));

    const { scanFiles } = await import("../scanner.js");
    const files = scanFiles(tmpDir);

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("small.ts");
  });
});
