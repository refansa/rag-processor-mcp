import type { PoolClient } from "pg";
import { StoreError } from "./errors.js";

export async function runMigrations(client: PoolClient, embeddingDimension: number): Promise<void> {
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
  } catch (err) {
    throw new StoreError(
      "PostgreSQL vector extension is required. Install it with: CREATE EXTENSION vector;",
      err,
    );
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS indexed_repos (
      repo_name   TEXT PRIMARY KEY,
      repo_url    TEXT NOT NULL,
      indexed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      chunk_count INTEGER NOT NULL DEFAULT 0,
      branch      TEXT,
      commit_hash TEXT
    )
  `);

  // Migration: add branch column for databases created before branch support
  await client.query(`
    ALTER TABLE indexed_repos ADD COLUMN IF NOT EXISTS branch TEXT
  `);

  // Migration: add commit_hash column
  await client.query(`
    ALTER TABLE indexed_repos ADD COLUMN IF NOT EXISTS commit_hash TEXT
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
      embedding    vector(${embeddingDimension}) NOT NULL
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_entries_repo
    ON store_entries (repo_name)
  `);

  // Migration: add text_search column for Hybrid Search
  await client.query(`
    ALTER TABLE store_entries ADD COLUMN IF NOT EXISTS text_search tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_entries_text_search
    ON store_entries USING GIN (text_search)
  `);

  try {
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_entries_hnsw
      ON store_entries USING hnsw (embedding vector_cosine_ops)
    `);
  } catch (err) {
    console.error(
      "[pg-provider] Failed to create HNSW index (pgvector >= 0.5.0 required); " +
        "falling back to exact search. Error:",
      err,
    );
  }
}
