/**
 * One-time migration: copy data from JSON files into PostgreSQL.
 *
 * Usage:
 *   export RAG_MCP_STORE_URL=postgresql://user:pass@localhost:5432/rag_mcp
 *   npx tsx scripts/migrate-json-to-pg.ts
 *
 * Requires: a running Postgres instance with the `vector` extension available.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Pool } from "pg";

const HOME = process.env.HOME || os.homedir();
const DATA_DIR = process.env.RAG_MCP_DATA_DIR || path.join(HOME, ".hermes", "rag-mcp-server");
const STORE_URL = process.env.RAG_MCP_STORE_URL || "postgresql://localhost:5432/rag_mcp";

const ENTRIES_JSON = path.join(DATA_DIR, "entries.json");
const REPOS_JSON = path.join(DATA_DIR, "repos.json");

interface JsonEntry {
  id: string;
  text: string;
  embedding: number[];
  metadata: {
    repoName: string;
    filePath: string;
    ext: string;
    chunkIndex: number;
    totalChunks: number;
  };
}

interface JsonRepo {
  repoName: string;
  repoUrl: string;
  indexedAt: string;
  chunkCount: number;
}

function toVectorString(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

async function main() {
  // Check that JSON files exist
  if (!fs.existsSync(ENTRIES_JSON) || !fs.existsSync(REPOS_JSON)) {
    console.error("No JSON data found in", DATA_DIR);
    console.error("Expected files:", ENTRIES_JSON, REPOS_JSON);
    process.exit(1);
  }

  const entries: JsonEntry[] = JSON.parse(fs.readFileSync(ENTRIES_JSON, "utf8"));
  const repos: JsonRepo[] = JSON.parse(fs.readFileSync(REPOS_JSON, "utf8"));

  console.error(`Found ${repos.length} repos and ${entries.length} entries in JSON files.`);

  const pool = new Pool({ connectionString: STORE_URL });

  try {
    // Ensure schema exists
    const client = await pool.connect();
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
      await client.query(`
        CREATE TABLE IF NOT EXISTS indexed_repos (
          repo_name   TEXT PRIMARY KEY,
          repo_url    TEXT NOT NULL,
          indexed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          chunk_count INTEGER NOT NULL DEFAULT 0
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS store_entries (
          id           TEXT PRIMARY KEY,
          repo_name    TEXT NOT NULL REFERENCES indexed_repos(repo_name),
          file_path    TEXT NOT NULL,
          ext          TEXT NOT NULL,
          chunk_index  INTEGER NOT NULL,
          total_chunks INTEGER NOT NULL DEFAULT 0,
          text         TEXT NOT NULL,
          embedding    vector(384) NOT NULL
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_entries_hnsw
        ON store_entries USING hnsw (embedding vector_cosine_ops)
      `);
    } finally {
      client.release();
    }

    // Insert repos
    for (const repo of repos) {
      await pool.query(
        `INSERT INTO indexed_repos (repo_name, repo_url, indexed_at, chunk_count)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (repo_name) DO UPDATE SET
           repo_url = EXCLUDED.repo_url,
           indexed_at = EXCLUDED.indexed_at,
           chunk_count = EXCLUDED.chunk_count`,
        [repo.repoName, repo.repoUrl, repo.indexedAt, repo.chunkCount],
      );
    }
    console.error(`Migrated ${repos.length} repos.`);

    // Insert entries in batches
    const BATCH = 100;
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);

      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        for (const entry of batch) {
          await c.query(
            `INSERT INTO store_entries (id, repo_name, file_path, ext, chunk_index, total_chunks, text, embedding)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)
             ON CONFLICT (id) DO NOTHING`,
            [
              entry.id,
              entry.metadata.repoName,
              entry.metadata.filePath,
              entry.metadata.ext,
              entry.metadata.chunkIndex,
              entry.metadata.totalChunks,
              entry.text,
              toVectorString(entry.embedding),
            ],
          );
        }
        await c.query("COMMIT");
      } catch (err) {
        await c.query("ROLLBACK");
        throw err;
      } finally {
        c.release();
      }

      console.error(`  ... ${Math.min(i + BATCH, entries.length)}/${entries.length} entries`);
    }

    console.error("Migration complete.");

    // Rename JSON files to .bak to prevent re-migration
    fs.renameSync(ENTRIES_JSON, `${ENTRIES_JSON}.bak`);
    fs.renameSync(REPOS_JSON, `${REPOS_JSON}.bak`);
    console.error("JSON files renamed to .bak");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
