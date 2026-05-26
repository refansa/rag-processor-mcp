import { Pool } from "pg";
import type { PoolClient } from "pg";
import type { IndexedRepo, SearchResult, StoreEntry } from "../types.js";
import { fuseResults } from "../rrf.js";
import type { SearchWhere, StoreProvider } from "./provider.js";
import { getConfig } from "../config.js";
import { StoreError } from "./errors.js";
import { runMigrations } from "./pg-migrations.js";

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
  indexed_at: Date;
  chunk_count: number;
  branch: string | null;
  commit_hash: string | null;
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

    this.pool.on("error", (err) => {
      console.error("[pg-provider] Pool error:", err);
    });

    this.embeddingDimension = Math.min(embeddingDimension ?? 384, 2000);
  }

  async connect(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await runMigrations(client, this.embeddingDimension);
    } finally {
      client.release();
    }
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }

  // ── Entry operations ────────────────────────────────────────────────

  async getRepoFiles(repoName: string): Promise<string[]> {
    const sql = `
      SELECT DISTINCT file_path
      FROM store_entries
      WHERE repo_name = $1
      ORDER BY file_path ASC
    `;
    try {
      const result = await this.pool.query(sql, [repoName]);
      return result.rows.map((row) => row.file_path);
    } catch (err) {
      throw new StoreError("Failed to get repo files", err);
    }
  }

  async getFileEntries(repoName: string, filePath: string): Promise<StoreEntry[]> {
    const sql = `
      SELECT id, repo_name, file_path, ext, chunk_index, total_chunks, text, embedding
      FROM store_entries
      WHERE repo_name = $1 AND file_path = $2
      ORDER BY chunk_index ASC
    `;
    try {
      const result = await this.pool.query(sql, [repoName, filePath]);
      return result.rows.map((row) => ({
        id: row.id,
        text: row.text,
        embedding: row.embedding ? JSON.parse(row.embedding) : [],
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
    queryText: string,
    queryEmbedding: number[],
    take: number,
    where?: SearchWhere,
  ): Promise<SearchResult[]> {
    const vec = toVectorString(queryEmbedding);

    const conditions: string[] = [];
    const vectorParams: unknown[] = [vec, take];
    const textParams: unknown[] = [queryText, take];
    let paramIdx = 3;

    if (where?.repo) {
      conditions.push(`repo_name = $${paramIdx}`);
      vectorParams.push(where.repo);
      textParams.push(where.repo);
      paramIdx++;
    }
    if (where?.ext) {
      conditions.push(`ext = $${paramIdx}`);
      vectorParams.push(where.ext);
      textParams.push(where.ext);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const textWhereClause =
      conditions.length > 0
        ? `WHERE text_search @@ websearch_to_tsquery('english', $1) AND ${conditions.join(" AND ")}`
        : `WHERE text_search @@ websearch_to_tsquery('english', $1)`;

    const vectorSql = `
      SELECT id, repo_name, file_path, ext, text,
             1 - (embedding <=> $1::vector) AS score
      FROM store_entries
      ${whereClause}
      ORDER BY (embedding <=> $1::vector) ASC
      LIMIT $2
    `;

    const textSql = `
      SELECT id, repo_name, file_path, ext, text,
             ts_rank(text_search, websearch_to_tsquery('english', $1)) AS score
      FROM store_entries
      ${textWhereClause}
      ORDER BY score DESC
      LIMIT $2
    `;

    try {
      const [vectorResult, textResult] = await Promise.all([
        this.pool.query<PgEntryRow>(vectorSql, vectorParams),
        this.pool.query<PgEntryRow>(textSql, textParams),
      ]);

      const mapRowToResult = (row: PgEntryRow) => ({
        content: row.text.slice(0, cfg.snippetMaxChars),
        file: row.file_path,
        id: row.id,
        repo: row.repo_name,
        score: Number(row.score),
      });

      const fused = fuseResults(
        vectorResult.rows.map(mapRowToResult),
        textResult.rows.map(mapRowToResult),
      );

      return fused.slice(0, take);
    } catch (err) {
      throw new StoreError("Failed to search entries", err);
    }
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
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM store_entries WHERE repo_name = $1", [repoName]);
      await client.query("UPDATE indexed_repos SET chunk_count = 0 WHERE repo_name = $1", [
        repoName,
      ]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new StoreError("Failed to remove repo entries", err);
    } finally {
      client.release();
    }
  }

  async removeFileEntries(repoName: string, filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) {
      return;
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const res = await client.query(
        "DELETE FROM store_entries WHERE repo_name = $1 AND file_path = ANY($2) RETURNING id",
        [repoName, filePaths],
      );

      const deletedCount = res.rowCount ?? 0;
      if (deletedCount > 0) {
        await client.query(
          "UPDATE indexed_repos SET chunk_count = GREATEST(0, chunk_count - $1) WHERE repo_name = $2",
          [deletedCount, repoName],
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new StoreError("Failed to remove file entries", err);
    } finally {
      client.release();
    }
  }

  async totalEntries(): Promise<number> {
    try {
      const result = await this.pool.query<{ count: string }>(
        "SELECT COUNT(*) as count FROM store_entries",
      );
      return parseInt(result.rows[0].count, 10);
    } catch (err) {
      throw new StoreError("Failed to count entries", err);
    }
  }

  async countRepoEntries(repoName: string): Promise<number> {
    try {
      const result = await this.pool.query<{ count: string }>(
        "SELECT COUNT(*) as count FROM store_entries WHERE repo_name = $1",
        [repoName],
      );
      return parseInt(result.rows[0].count, 10);
    } catch (err) {
      throw new StoreError("Failed to count repo entries", err);
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
        "SELECT repo_name, repo_url, indexed_at, chunk_count, branch, commit_hash FROM indexed_repos ORDER BY repo_name",
      );
      return result.rows.map((row) => ({
        branch: row.branch ?? undefined,
        chunkCount: row.chunk_count,
        indexedAt: row.indexed_at.toISOString(),
        repoName: row.repo_name,
        repoUrl: row.repo_url,
        commitHash: row.commit_hash ?? undefined,
      }));
    } catch (err) {
      throw new StoreError("Failed to list repos", err);
    }
  }

  async save(repo: IndexedRepo): Promise<void> {
    const sql = `
      INSERT INTO indexed_repos (repo_name, repo_url, indexed_at, chunk_count, branch, commit_hash)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (repo_name) DO UPDATE SET
        repo_url   = EXCLUDED.repo_url,
        indexed_at = EXCLUDED.indexed_at,
        chunk_count = EXCLUDED.chunk_count,
        branch     = EXCLUDED.branch,
        commit_hash = EXCLUDED.commit_hash
    `;
    try {
      await this.pool.query(sql, [
        repo.repoName,
        repo.repoUrl,
        repo.indexedAt,
        repo.chunkCount,
        repo.branch ?? null,
        repo.commitHash ?? null,
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
