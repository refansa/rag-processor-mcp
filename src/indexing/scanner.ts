/**
 * File system scanner: walk repo directory, collect matching files.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getConfig } from "../core/config.js";
import type { FileInfo } from "../core/types.js";

const cfg = getConfig();

export const INCLUDE_EXTS = new Set(cfg.includeExts);
export const EXCLUDE_DIRS = new Set(cfg.excludeDirs);
export const MAX_BYTES = cfg.maxFileBytes;

export function scanFiles(repoPath: string): FileInfo[] {
  const files: FileInfo[] = [];

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (EXCLUDE_DIRS.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!INCLUDE_EXTS.has(ext)) {
          continue;
        }
        const stat = fs.statSync(fullPath);
        if (stat.size > MAX_BYTES) {
          continue;
        }
        try {
          const content = fs.readFileSync(fullPath, "utf8");
          if (content.length === 0) {
            continue;
          }
          const relPath = path.relative(repoPath, fullPath).split(path.sep).join("/");
          files.push({ content, ext, path: relPath });
        } catch {
          // Skip binary/unreadable files
        }
      }
    }
  }

  walk(repoPath);
  return files;
}
