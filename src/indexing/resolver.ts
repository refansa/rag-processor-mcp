/**
 * Git repo resolution: local path or clone/pull remote repos.
 */

import simpleGitModule from "simple-git";
import * as fs from "node:fs";
import * as path from "node:path";
import { getConfig } from "../core/config.js";

const cfg = getConfig();
const CACHE_DIR = cfg.reposDir;

function extractRepoName(repoRef: string): string {
  if (fs.existsSync(repoRef) && fs.statSync(repoRef).isDirectory()) {
    return path.basename(path.resolve(repoRef));
  }
  const name =
    repoRef
      .replace(/\.git$/, "")
      .split("/")
      .filter(Boolean)
      .pop() || "unknown";
  return name;
}

export async function resolveRepo(
  repoRef: string,
): Promise<{ localPath: string; repoName: string }> {
  const repoName = extractRepoName(repoRef);

  if (fs.existsSync(repoRef) && fs.statSync(repoRef).isDirectory()) {
    return { localPath: path.resolve(repoRef), repoName };
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const localPath = path.join(CACHE_DIR, repoName);

  if (fs.existsSync(localPath)) {
    console.error(`[indexer] Pulling latest for ${repoName}...`);
    const git = simpleGitModule({ baseDir: localPath });
    await git.pull();
  } else {
    console.error(`[indexer] Cloning ${repoRef}...`);
    const git = simpleGitModule();
    await git.clone(repoRef, localPath);
  }

  return { localPath, repoName };
}
