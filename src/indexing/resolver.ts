/**
 * Git repo resolution: local path or clone/pull remote repos.
 */

import simpleGitModule from "simple-git";
import * as fs from "node:fs";
import * as path from "node:path";
import { AbortError } from "../core/abort-error.js";
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
  signal?: AbortSignal,
  branch?: string,
): Promise<{ localPath: string; repoName: string }> {
  const repoName = extractRepoName(repoRef);

  if (fs.existsSync(repoRef) && fs.statSync(repoRef).isDirectory()) {
    return { localPath: path.resolve(repoRef), repoName };
  }

  if (signal?.aborted) {
    throw new AbortError("Cancelled before cloning");
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const localPath = path.join(CACHE_DIR, repoName);

  if (fs.existsSync(localPath)) {
    if (branch) {
      console.error(`[indexer] Syncing branch ${branch} for ${repoName}...`);
      const git = simpleGitModule({ baseDir: localPath });
      await git.fetch("origin", branch);
      await git.raw(["checkout", "-B", branch, `origin/${branch}`]);
    } else {
      console.error(`[indexer] Pulling latest for ${repoName}...`);
      const git = simpleGitModule({ baseDir: localPath });
      await git.pull();
    }
  } else {
    const cloneOpts = branch ? ["--single-branch", "--branch", branch] : ["--single-branch"];
    console.error(`[indexer] Cloning ${repoRef} (${cloneOpts.join(" ")})...`);
    const git = simpleGitModule();
    await git.clone(repoRef, localPath, cloneOpts);
  }

  if (signal?.aborted) {
    throw new AbortError("Cancelled after cloning");
  }

  return { localPath, repoName };
}
