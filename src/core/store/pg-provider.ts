import { Pool } from "pg";
import type { PoolClient } from "pg";
import type { IndexedRepo, SearchResult, StoreEntry } from "../types.js";
import type { SearchWhere, StoreProvider } from "./provider.js";
import { getConfig } from "../config.js";
import { StoreError } from "./errors.js";

const cfg = getConfig();

interface PgEntryRow {
  id: string;
  repo_name: string;
  file_path: string;
  ext: string;
  chunk_index: number;
  total_chunks: number;
  text: string;
  score: string;
}

interface PgRepoRow {
  repo_name: string;
  repo_url: string;
  indexed_at: string;
  chunk_count: number;
  branch: string | null;
}

function toVectorString(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export class PgProvider implements StoreProvider {
  private pool: Pool;
  private readonly embeddingDimension: number;

  constructor(url: string, poolSize?: number, embeddingDimension?: number) {
    this.pool = new Pool({
      connectionString: url,
      max: poolSize ?? 5,
    });

    this.embeddingDimension = Math.min(embeddingDimension!, 2000); // Hard limit to 2000 to support HNSW.
  }

  async connect(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");

      await client.query(`
        CREATE TABLE IF NOT EXISTS indexed_repos (
          repo_name   TEXT PRIMARY KEY,
          repo_url    TEXT NOT NULL,
          indexed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          chunk_count INTEGER NOT NULL DEFAULT 0,
          branch      TEXT
        )
      `);

      // Migration: add branch column for databases created before branch support
      await client.query(`
        ALTER TABLE indexed_repos ADD COLUMN IF NOT EXISTS branch TEXT
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
          embedding    vector(${this.embeddingDimension}) NOT NULL
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_entries_repo
        ON store_entries (repo_name)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_entries_hnsw
        ON store_entries USING hnsw (embedding vector_cosine_ops)
      `);
    } finally {
      client.release();
    }
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }

  // ── Entry operations ────────────────────────────────────────────────

  async getFileEntries(repoName: string, filePath: string): Promise<StoreEntry[]> {
    const sql = `
      SELECT id, repo_name, file_path, ext, chunk_index, total_chunks, text
      FROM store_entries
      WHERE repo_name = $1 AND file_path = $2
      ORDER BY chunk_index ASC
    `;
    try {
      const result = await this.pool.query(sql, [repoName, filePath]);
      return result.rows.map((row) => ({
        id: row.id,
        text: row.text,
        embedding: [],
        metadata: {
          chunkIndex: row.chunk_index,
          ext: row.ext,
          filePath: row.file_path,
          repoName: row.repo_name,
          totalChunks: row.total_chunks,
        },
      }));
    } catch (err) {
      throw new StoreError("Failed to get file entries", err);
    }
  }

  async searchSimilar(
    queryEmbedding: number[],
    take: number,
    where?: SearchWhere,
  ): Promise<SearchResult[]> {
    const vec = toVectorString(queryEmbedding);

    // Build WHERE clause dynamically
    const conditions: string[] = [];
    const params: unknown[] = [vec, take];
    let paramIdx = 3;

    if (where?.repo) {
      conditions.push(`repo_name = $${paramIdx++}`);
      params.push(where.repo);
    }
    if (where?.ext) {
      conditions.push(`ext = $${paramIdx++}`);
      params.push(where.ext);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `
      SELECT id, repo_name, file_path, ext, text,
             1 - (embedding <=> $1::vector) AS score
      FROM store_entries
      ${whereClause}
      ORDER BY score DESC
      LIMIT $2
    `;

    let result;
    try {
      result = await this.pool.query<PgEntryRow>(sql, params);
    } catch (err) {
      throw new StoreError("Failed to search entries", err);
    }

    return result.rows.map((row) => ({
      content: row.text.slice(0, cfg.snippetMaxChars),
      file: row.file_path,
      id: row.id,
      repo: row.repo_name,
      score: Number(row.score),
    }));
  }

  async insertOne(entry: StoreEntry): Promise<void> {
    const sql = `
      INSERT INTO store_entries (id, repo_name, file_path, ext, chunk_index, total_chunks, text, embedding)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)
      ON CONFLICT (id) DO NOTHING
    `;
    try {
      await this.pool.query(sql, [
        entry.id,
        entry.metadata.repoName,
        entry.metadata.filePath,
        entry.metadata.ext,
        entry.metadata.chunkIndex,
        entry.metadata.totalChunks,
        entry.text,
        toVectorString(entry.embedding),
      ]);
    } catch (err) {
      throw new StoreError("Failed to insert entry", err);
    }
  }

  async insertBatch(entries: StoreEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.multiRowInsert(client, entries);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new StoreError("Failed to insert batch", err);
    } finally {
      client.release();
    }
  }

  async overwriteRepoEntries(repoName: string, entries: StoreEntry[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query("DELETE FROM store_entries WHERE repo_name = $1", [repoName]);

      if (entries.length > 0) {
        await this.multiRowInsert(client, entries);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new StoreError("Failed to overwrite repo entries", err);
    } finally {
      client.release();
    }
  }

  async removeRepoEntries(repoName: string): Promise<void> {
    try {
      await this.pool.query("DELETE FROM store_entries WHERE repo_name = $1", [repoName]);
    } catch (err) {
      throw new StoreError("Failed to remove repo entries", err);
    }
  }

  async totalEntries(): Promise<number> {
    try {
      const result = await this.pool.query<{ count: string }>(
        "SELECT COUNT(*) AS count FROM store_entries",
      );
      return Number(result.rows[0].count);
    } catch (err) {
      throw new StoreError("Failed to count entries", err);
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  private async multiRowInsert(client: PoolClient, entries: StoreEntry[]): Promise<void> {
    const COLS = "id, repo_name, file_path, ext, chunk_index, total_chunks, text, embedding";
    const ROWS_PER_STATEMENT = 500;

    for (let i = 0; i < entries.length; i += ROWS_PER_STATEMENT) {
      const batch = entries.slice(i, i + ROWS_PER_STATEMENT);
      const placeholders = batch
        .map((_, ri) => {
          const base = ri * 8;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}::vector)`;
        })
        .join(", ");
      const params = batch.flatMap((e) => [
        e.id,
        e.metadata.repoName,
        e.metadata.filePath,
        e.metadata.ext,
        e.metadata.chunkIndex,
        e.metadata.totalChunks,
        e.text,
        toVectorString(e.embedding),
      ]);
      await client.query(
        `INSERT INTO store_entries (${COLS}) VALUES ${placeholders} ON CONFLICT (id) DO NOTHING`,
        params,
      );
    }
  }

  // ── Repo operations ──────────────────────────────────────────────────

  async listAll(): Promise<IndexedRepo[]> {
    try {
      const result = await this.pool.query<PgRepoRow>(
        "SELECT repo_name, repo_url, indexed_at, chunk_count, branch FROM indexed_repos ORDER BY repo_name",
      );
      return result.rows.map((row) => ({
        branch: row.branch ?? undefined,
        chunkCount: row.chunk_count,
        indexedAt: row.indexed_at,
        repoName: row.repo_name,
        repoUrl: row.repo_url,
      }));
    } catch (err) {
      throw new StoreError("Failed to list repos", err);
    }
  }

  async save(repo: IndexedRepo): Promise<void> {
    const sql = `
      INSERT INTO indexed_repos (repo_name, repo_url, indexed_at, chunk_count, branch)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (repo_name) DO UPDATE SET
        repo_url   = EXCLUDED.repo_url,
        indexed_at = EXCLUDED.indexed_at,
        chunk_count = EXCLUDED.chunk_count,
        branch     = EXCLUDED.branch
    `;
    try {
      await this.pool.query(sql, [
        repo.repoName,
        repo.repoUrl,
        repo.indexedAt,
        repo.chunkCount,
        repo.branch ?? null,
      ]);
    } catch (err) {
      throw new StoreError("Failed to save repo", err);
    }
  }

  async removeOne(repoName: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM store_entries WHERE repo_name = $1", [repoName]);
      await client.query("DELETE FROM indexed_repos WHERE repo_name = $1", [repoName]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new StoreError("Failed to remove repo", err);
    } finally {
      client.release();
    }
  }
}
