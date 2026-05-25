import { Store } from "./core/store/index.js";
import { indexRepo } from "./indexing/index.js";
import { getConfig } from "./core/config.js";

export async function runCli(args: string[]) {
  const cfg = getConfig();

  const store = new Store({
    embeddingDimension: cfg.store.embeddingDimension,
    poolSize: cfg.store.poolSize,
    provider: cfg.store.provider,
    url: cfg.store.url,
  });

  const command = args[0];

  try {
    await store.$connect();

    switch (command) {
      case "index-repo": {
        const repo_url = args[1];
        const branch = args[2];
        if (!repo_url) {
          throw new Error("Usage: index-repo <repo_url> [branch]");
        }

        console.log(`Indexing ${repo_url}${branch ? ` (branch: ${branch})` : ""}...`);
        const result = await indexRepo(repo_url, store, {
          branch,
          onProgress: (p) => {
            console.log(`[${p.current}/${p.total}] ${p.message}`);
          },
        });
        console.log(
          `Successfully indexed ${result.fileCount} files (${result.chunkCount} chunks) from ${result.repoName}.`,
        );
        break;
      }
      case "remove-repo": {
        const repo_name = args[1];
        if (!repo_name) {
          throw new Error("Usage: remove-repo <repo_name>");
        }

        console.log(`Removing repository ${repo_name}...`);
        await store.repo.removeOne(repo_name);
        console.log(`Successfully removed ${repo_name}.`);
        break;
      }
      default: {
        console.log(`Unknown command: ${command}`);
        console.log("Available commands: index-repo <repo_url> [branch], remove-repo <repo_name>");
        process.exit(1);
      }
    }
  } catch (err) {
    console.error("CLI Error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await store.$disconnect();
  }
}
