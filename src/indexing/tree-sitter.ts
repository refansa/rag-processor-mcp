import type { Chunk } from "../core/types.js";
import { CHUNK_OVERLAP, CHUNK_SIZE } from "./chunker.js";

// We use dynamic imports to prevent crashing if the native dependencies
// are not built or fail to load on the host environment (e.g. Windows without MSVC).
let Parser: any = null;
const grammars = new Map<string, any>();

let initialized = false;

export async function initTreeSitter() {
  if (initialized) {
    return;
  }
  initialized = true;

  try {
    const treeSitterModule = await import("tree-sitter");
    Parser = treeSitterModule.default || treeSitterModule;

    const tsModule = await import("tree-sitter-typescript");
    const jsModule = await import("tree-sitter-javascript");
    const vueModule = await import("tree-sitter-vue");

    grammars.set(".ts", tsModule.default?.typescript || tsModule.typescript || tsModule);
    grammars.set(".tsx", tsModule.default?.tsx || tsModule.tsx || tsModule);
    grammars.set(".js", jsModule.default || jsModule);
    grammars.set(".jsx", jsModule.default || jsModule);
    grammars.set(".vue", vueModule.default || vueModule);

    console.error(`[indexer] Tree-sitter initialized with TS/JS/Vue grammars.`);
  } catch (err) {
    console.error(
      `[indexer] Tree-sitter native modules not available. Falling back to character-based chunking.`,
      err instanceof Error ? err.message : err,
    );
    Parser = null;
  }
}

function chunkByCharacters(
  text: string,
  baseIndex: number,
  filePath: string,
  repoName: string,
  ext: string,
): Chunk[] {
  const chunks: Chunk[] = [];
  if (text.length <= CHUNK_SIZE) {
    chunks.push({
      id: `${repoName}::${filePath}::${baseIndex}`,
      metadata: { chunkIndex: baseIndex, ext, filePath, repoName, totalChunks: 1 },
      text,
    });
    return chunks;
  }

  let index = baseIndex;
  for (let i = 0; i < text.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    const end = Math.min(i + CHUNK_SIZE, text.length);
    chunks.push({
      id: `${repoName}::${filePath}::${index}`,
      metadata: { chunkIndex: index, ext, filePath, repoName, totalChunks: 0 }, // totalChunks will be fixed later
      text: text.slice(i, end),
    });
    index++;
  }
  return chunks;
}

export function chunkWithTreeSitter(
  content: string,
  filePath: string,
  repoName: string,
  ext: string,
): Chunk[] {
  if (!Parser || !grammars.has(ext)) {
    return chunkByCharacters(content, 0, filePath, repoName, ext);
  }

  try {
    const parser = new Parser();
    parser.setLanguage(grammars.get(ext));
    const tree = parser.parse(content);

    const chunks: Chunk[] = [];
    let currentIndex = 0;

    // A simple AST traversal to find logical top-level nodes
    const root = tree.rootNode;

    // Nodes that represent logical standalone concepts that we want to chunk as a whole
    const logicalNodeTypes = new Set([
      "function_declaration",
      "class_declaration",
      "method_definition",
      "interface_declaration",
      "type_alias_declaration",
      "export_statement",
      // Vue specific
      "script_element",
      "template_element",
      "style_element",
    ]);

    let currentChunkText = "";

    for (let i = 0; i < root.childCount; i++) {
      const child = root.child(i);
      if (!child) {
        continue;
      }

      const text = child.text;

      // If the child is a major logical node, or if appending it would exceed chunk size
      if (logicalNodeTypes.has(child.type) || currentChunkText.length + text.length > CHUNK_SIZE) {
        // Flush existing buffer if it has content
        if (currentChunkText.trim().length > 0) {
          const subChunks = chunkByCharacters(
            currentChunkText,
            currentIndex,
            filePath,
            repoName,
            ext,
          );
          chunks.push(...subChunks);
          currentIndex += subChunks.length;
          currentChunkText = "";
        }

        // Now process the current logical node
        if (text.length > CHUNK_SIZE) {
          // If the single logical node is STILL too big, fall back to character chunking for it
          const subChunks = chunkByCharacters(text, currentIndex, filePath, repoName, ext);
          chunks.push(...subChunks);
          currentIndex += subChunks.length;
        } else {
          chunks.push({
            id: `${repoName}::${filePath}::${currentIndex}`,
            metadata: { chunkIndex: currentIndex, ext, filePath, repoName, totalChunks: 0 },
            text,
          });
          currentIndex++;
        }
      } else {
        // Accumulate smaller nodes together
        currentChunkText += `${text}\n`;
      }
    }

    // Flush any remaining
    if (currentChunkText.trim().length > 0) {
      const subChunks = chunkByCharacters(currentChunkText, currentIndex, filePath, repoName, ext);
      chunks.push(...subChunks);
    }

    // Fix totalChunks
    for (const c of chunks) {
      c.metadata.totalChunks = chunks.length;
    }

    return chunks.length > 0 ? chunks : chunkByCharacters(content, 0, filePath, repoName, ext);
  } catch (err) {
    console.error(
      `[indexer] Error parsing AST for ${filePath}. Falling back.`,
      err instanceof Error ? err.message : err,
    );
    return chunkByCharacters(content, 0, filePath, repoName, ext);
  }
}
