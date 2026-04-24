import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'path';
import fs from 'fs';
import { Document, DocumentChunk, SearchFilters, SearchResult } from '../types.js';
import { tokenize, tokenizeQuery } from '../utils/tokenizer.js';
import { chunkDocument } from '../utils/chunker.js';
const EMBEDDING_DIM = 384;
const RRF_K = 60;

function vecToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export class KnowledgeDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    sqliteVec.load(this.db);
    this.db.pragma('journal_mode = WAL');
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL,
        title TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT NOT NULL,
        last_synced TEXT NOT NULL, UNIQUE(source, source_id)
      );
      CREATE INDEX IF NOT EXISTS idx_source ON documents(source);
      CREATE INDEX IF NOT EXISTS idx_title ON documents(title);
      CREATE INDEX IF NOT EXISTS idx_last_synced ON documents(last_synced);
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL, content TEXT NOT NULL,
        tokenized_content TEXT NOT NULL, has_embedding INTEGER NOT NULL DEFAULT 0,
        UNIQUE(doc_id, chunk_index),
        FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(doc_id);
    `);
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        doc_id UNINDEXED, chunk_index UNINDEXED, title, content, tokenize='unicode61'
      );
    `);
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
        chunk_id INTEGER PRIMARY KEY, embedding float[${EMBEDDING_DIM}]
      );
    `);
    this.migrateIfNeeded();
  }

  private migrateIfNeeded(): void {
    const hasOldFts = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='documents_fts'"
    ).get();
    if (hasOldFts) {
      this.db.exec(`
        DROP TRIGGER IF EXISTS documents_ai; DROP TRIGGER IF EXISTS documents_ad;
        DROP TRIGGER IF EXISTS documents_au; DROP TABLE IF EXISTS documents_fts;
      `);
    }
    try { this.db.prepare('SELECT has_embedding FROM chunks LIMIT 1').get(); }
    catch { try { this.db.exec('ALTER TABLE chunks ADD COLUMN has_embedding INTEGER NOT NULL DEFAULT 0'); } catch { /* ok */ } }

    const chunkCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM chunks').get() as any).cnt;
    const docCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM documents').get() as any).cnt;
    if (docCount > 0 && chunkCount === 0) this.rebuildChunksFromDocuments();
  }

  private rebuildChunksFromDocuments(): void {
    const docs = this.db.prepare('SELECT id, title, content FROM documents').all() as any[];
    const insertChunk = this.db.prepare(
      'INSERT OR REPLACE INTO chunks (doc_id, chunk_index, content, tokenized_content, has_embedding) VALUES (?, ?, ?, ?, 0)'
    );
    const insertFts = this.db.prepare(
      'INSERT INTO chunks_fts (doc_id, chunk_index, title, content) VALUES (?, ?, ?, ?)'
    );
    const rebuild = this.db.transaction(() => {
      for (const doc of docs) {
        const chunks = chunkDocument(doc.content);
        const tokenizedTitle = tokenize(doc.title);
        for (const chunk of chunks) {
          const tc = tokenize(chunk.text);
          insertChunk.run(doc.id, chunk.index, chunk.text, tc);
          insertFts.run(doc.id, chunk.index, tokenizedTitle, tc);
        }
      }
    });
    rebuild();
  }

  upsertDocument(doc: Document): void {
    const upsertDoc = this.db.prepare(`
      INSERT INTO documents (id, source, source_id, title, content, metadata, last_synced)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, source_id) DO UPDATE SET
        title=excluded.title, content=excluded.content,
        metadata=excluded.metadata, last_synced=excluded.last_synced
    `);
    const txn = this.db.transaction(() => {
      upsertDoc.run(doc.id, doc.source, doc.source_id, doc.title,
        doc.content, JSON.stringify(doc.metadata), doc.last_synced);
      this.deleteChunksForDoc(doc.id);
      this.insertChunksForDoc(doc.id, doc.title, doc.content);
    });
    txn();
  }

  batchUpsert(docs: Document[]): void {
    const upsertDoc = this.db.prepare(`
      INSERT INTO documents (id, source, source_id, title, content, metadata, last_synced)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, source_id) DO UPDATE SET
        title=excluded.title, content=excluded.content,
        metadata=excluded.metadata, last_synced=excluded.last_synced
    `);
    const txn = this.db.transaction(() => {
      for (const doc of docs) {
        upsertDoc.run(doc.id, doc.source, doc.source_id, doc.title,
          doc.content, JSON.stringify(doc.metadata), doc.last_synced);
        this.deleteChunksForDoc(doc.id);
        this.insertChunksForDoc(doc.id, doc.title, doc.content);
      }
    });
    txn();
  }

  private deleteChunksForDoc(docId: string): void {
    const oldIds = this.db.prepare('SELECT id FROM chunks WHERE doc_id = ?').all(docId) as any[];
    const delVec = this.db.prepare('DELETE FROM chunks_vec WHERE chunk_id = ?');
    for (const c of oldIds) { try { delVec.run(c.id); } catch { /* ok */ } }
    this.db.prepare('DELETE FROM chunks_fts WHERE doc_id = ?').run(docId);
    this.db.prepare('DELETE FROM chunks WHERE doc_id = ?').run(docId);
  }

  private insertChunksForDoc(docId: string, title: string, content: string): void {
    const insertChunk = this.db.prepare(
      'INSERT INTO chunks (doc_id, chunk_index, content, tokenized_content, has_embedding) VALUES (?, ?, ?, ?, 0)'
    );
    const insertFts = this.db.prepare(
      'INSERT INTO chunks_fts (doc_id, chunk_index, title, content) VALUES (?, ?, ?, ?)'
    );
    const chunks = chunkDocument(content);
    const tokenizedTitle = tokenize(title);
    for (const chunk of chunks) {
      const tc = tokenize(chunk.text);
      insertChunk.run(docId, chunk.index, chunk.text, tc);
      insertFts.run(docId, chunk.index, tokenizedTitle, tc);
    }
  }

  /**
   * 获取某个 chunk 所属的文档 ID
   */
  getChunkDocId(chunkId: number): string | null {
    const row = this.db.prepare('SELECT doc_id FROM chunks WHERE id = ?').get(chunkId) as any;
    return row ? row.doc_id : null;
  }

  /**
   * 获取某个文档的 chunk 数量
   */
  getDocumentChunkCount(docId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM chunks WHERE doc_id = ?').get(docId) as any;
    return row.cnt;
  }

  // ==================== Embedding ====================

  getChunksWithoutEmbedding(limit: number = 500): Array<{ id: number; content: string }> {
    return this.db.prepare(
      'SELECT id, content FROM chunks WHERE has_embedding = 0 LIMIT ?'
    ).all(limit) as any[];
  }

  batchInsertEmbeddings(items: Array<{ chunkId: number; embedding: Float32Array }>): void {
    const markDone = this.db.prepare('UPDATE chunks SET has_embedding = 1 WHERE id = ?');
    const txn = this.db.transaction(() => {
      for (const item of items) {
        // vec0 requires literal integer PK, not parameterized
        this.db.prepare(`INSERT INTO chunks_vec(chunk_id, embedding) VALUES (${item.chunkId}, ?)`).run(vecToBuffer(item.embedding));
        markDone.run(item.chunkId);
      }
    });
    txn();
  }

  getEmbeddingStats(): { total: number; withEmbedding: number; without: number } {
    const total = (this.db.prepare('SELECT COUNT(*) as cnt FROM chunks').get() as any).cnt;
    const withEmb = (this.db.prepare('SELECT COUNT(*) as cnt FROM chunks WHERE has_embedding = 1').get() as any).cnt;
    return { total, withEmbedding: withEmb, without: total - withEmb };
  }

  // ==================== Search ====================

  /**
   * BM25 关键词搜索（FTS5）
   */
  private searchBM25(tokenizedQuery: string, source?: string, limit: number = 40, pathLike?: string): Array<{ chunkId: number; docId: string; rank: number }> {
    const conds: string[] = ['chunks_fts MATCH ?'];
    const params: any[] = [tokenizedQuery];
    let join = '';
    if (source || pathLike) {
      join = ' JOIN documents d ON d.id = fts.doc_id';
      if (source) { conds.push('d.source = ?'); params.push(source); }
      if (pathLike) { conds.push('d.source_id LIKE ?'); params.push(pathLike); }
    }
    const sql = `
      SELECT c.id as chunkId, fts.doc_id as docId,
        bm25(chunks_fts, 0, 0, 10.0, 1.0) as rank
      FROM chunks_fts fts
      JOIN chunks c ON c.doc_id = fts.doc_id AND c.chunk_index = fts.chunk_index
      ${join}
      WHERE ${conds.join(' AND ')}
      ORDER BY rank LIMIT ?
    `;
    params.push(limit);
    return this.db.prepare(sql).all(...params) as any[];
  }

  /**
   * 向量 KNN 搜索（sqlite-vec）。可选 pathLike 通过 JOIN documents 过滤。
   * 因为 vec0 不支持任意 WHERE，带过滤时用迭代 over-fetch：
   * 初始取 limit*5，过滤后不够则翻倍重试，上限 limit*50。
   * 这样能显著降低"相关 chunk 不在全局 top 池里就被漏召回"的风险。
   */
  private searchVector(queryEmbedding: Buffer, limit: number = 40, source?: string, pathLike?: string): Array<{ chunkId: number; distance: number }> {
    if (!source && !pathLike) {
      return this.db.prepare(
        'SELECT chunk_id as chunkId, distance FROM chunks_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?'
      ).all(queryEmbedding, limit) as any[];
    }
    const maxOverFetch = limit * 50;
    let fetchSize = Math.min(limit * 5, maxOverFetch);
    let lastFiltered: Array<{ chunkId: number; distance: number }> = [];
    while (true) {
      const candidates = this.db.prepare(
        'SELECT chunk_id as chunkId, distance FROM chunks_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?'
      ).all(queryEmbedding, fetchSize) as any[];
      if (candidates.length === 0) return [];
      const ids = candidates.map((c) => c.chunkId);
      const placeholders = ids.map(() => '?').join(',');
      const conds: string[] = [`c.id IN (${placeholders})`];
      const params: any[] = [...ids];
      if (source) { conds.push('d.source = ?'); params.push(source); }
      if (pathLike) { conds.push('d.source_id LIKE ?'); params.push(pathLike); }
      const allowed = new Set(
        (this.db.prepare(
          `SELECT c.id as id FROM chunks c JOIN documents d ON d.id = c.doc_id WHERE ${conds.join(' AND ')}`
        ).all(...params) as any[]).map((r) => r.id)
      );
      lastFiltered = candidates.filter((c) => allowed.has(c.chunkId));
      // 命中数足够 / 已无更多候选 / 已达上限 → 收手
      if (lastFiltered.length >= limit || candidates.length < fetchSize || fetchSize >= maxOverFetch) {
        return lastFiltered.slice(0, limit);
      }
      fetchSize = Math.min(fetchSize * 2, maxOverFetch);
    }
  }

  /**
   * 混合搜索：BM25 + Vector + RRF 融合
   */
  searchDocuments(query: string, filters?: SearchFilters, limit: number = 20, queryEmbedding?: Buffer): SearchResult[] {
    const tokenizedQuery = tokenizeQuery(query);

    // BM25 search
    let bm25Results: Array<{ chunkId: number; docId: string; rank: number }> = [];
    try {
      bm25Results = this.searchBM25(tokenizedQuery, filters?.source, limit * 3, filters?.path_like);
    } catch { /* FTS match can fail on some queries */ }

    // Vector search (if embedding provided)
    let vecResults: Array<{ chunkId: number; distance: number }> = [];
    if (queryEmbedding) {
      const embStats = this.getEmbeddingStats();
      if (embStats.withEmbedding > 0) {
        try { vecResults = this.searchVector(queryEmbedding, limit * 3, filters?.source, filters?.path_like); } catch { /* ok */ }
      }
    }

    // RRF fusion
    const chunkScores = new Map<number, { score: number; docId: string }>();

    // BM25 ranked list
    bm25Results.forEach((r, i) => {
      const existing = chunkScores.get(r.chunkId);
      const rrfScore = 1 / (RRF_K + i + 1);
      if (existing) {
        existing.score += rrfScore;
      } else {
        chunkScores.set(r.chunkId, { score: rrfScore, docId: r.docId });
      }
    });

    // Vector ranked list
    vecResults.forEach((r, i) => {
      const rrfScore = 1 / (RRF_K + i + 1);
      const existing = chunkScores.get(r.chunkId);
      if (existing) {
        existing.score += rrfScore;
      } else {
        // Need to look up docId for this chunk
        const chunk = this.db.prepare('SELECT doc_id FROM chunks WHERE id = ?').get(r.chunkId) as any;
        if (chunk) {
          chunkScores.set(r.chunkId, { score: rrfScore, docId: chunk.doc_id });
        }
      }
    });

    // Sort by fused score, allow up to MAX_CHUNKS_PER_DOC chunks per document
    const MAX_CHUNKS_PER_DOC = 3;
    const sorted = [...chunkScores.entries()].sort((a, b) => b[1].score - a[1].score);
    const docChunkCount = new Map<string, number>();
    const results: SearchResult[] = [];

    for (const [chunkId, { score, docId }] of sorted) {
      const count = docChunkCount.get(docId) || 0;
      if (count >= MAX_CHUNKS_PER_DOC) continue;
      docChunkCount.set(docId, count + 1);

      const doc = this.db.prepare('SELECT id, source, source_id, title, metadata FROM documents WHERE id = ?').get(docId) as any;
      const chunk = this.db.prepare('SELECT chunk_index, content FROM chunks WHERE id = ?').get(chunkId) as any;
      if (!doc || !chunk) continue;

      const snippet = this.generateSnippet(chunk.content, query);

      results.push({
        id: doc.id, source: doc.source, source_id: doc.source_id,
        title: doc.title, snippet, chunk_index: chunk.chunk_index,
        rank: score, metadata: JSON.parse(doc.metadata),
      });
      if (results.length >= limit) break;
    }

    return results;
  }

  /**
   * 生成搜索结果 snippet：定位到查询词首次出现的位置，截取上下文
   */
  private generateSnippet(content: string, query: string, maxLen: number = 300): string {
    if (content.length <= maxLen) return content;

    const terms = query.split(/\s+/).filter(t => t.length > 1);
    let bestPos = -1;

    for (const term of terms) {
      const idx = content.toLowerCase().indexOf(term.toLowerCase());
      if (idx >= 0) {
        bestPos = idx;
        break;
      }
    }

    if (bestPos < 0) {
      return content.substring(0, maxLen) + '...';
    }

    const halfLen = Math.floor(maxLen / 2);
    let start = Math.max(0, bestPos - halfLen);
    let end = Math.min(content.length, start + maxLen);
    if (end - start < maxLen) {
      start = Math.max(0, end - maxLen);
    }

    let snippet = content.substring(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < content.length) snippet += '...';

    return snippet;
  }

  // ==================== Utility ====================

  getDocument(id: string): Document | undefined {
    const row = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return { id: row.id, source: row.source, source_id: row.source_id, title: row.title,
      content: row.content, metadata: JSON.parse(row.metadata), last_synced: row.last_synced };
  }

  getAllDocuments(source?: string, limit: number = 100): Document[] {
    let sql = 'SELECT * FROM documents';
    const params: any[] = [];
    if (source) { sql += ' WHERE source = ?'; params.push(source); }
    sql += ' ORDER BY last_synced DESC LIMIT ?';
    params.push(limit);
    return (this.db.prepare(sql).all(...params) as any[]).map(row => ({
      id: row.id, source: row.source, source_id: row.source_id, title: row.title,
      content: row.content, metadata: JSON.parse(row.metadata), last_synced: row.last_synced,
    }));
  }

  deleteDocument(id: string): void {
    const txn = this.db.transaction(() => {
      const chunkIds = this.db.prepare('SELECT id FROM chunks WHERE doc_id = ?').all(id) as any[];
      const delVec = this.db.prepare('DELETE FROM chunks_vec WHERE chunk_id = ?');
      for (const c of chunkIds) { try { delVec.run(c.id); } catch { /* ok */ } }
      this.db.prepare('DELETE FROM chunks_fts WHERE doc_id = ?').run(id);
      this.db.prepare('DELETE FROM chunks WHERE doc_id = ?').run(id);
      this.db.prepare('DELETE FROM documents WHERE id = ?').run(id);
    });
    txn();
  }

  batchDeleteDocuments(ids: string[]): void {
    const txn = this.db.transaction(() => { for (const id of ids) this.deleteDocument(id); });
    txn();
  }

  getAllDocumentIds(source?: string): string[] {
    let sql = 'SELECT id FROM documents';
    const params: any[] = [];
    if (source) { sql += ' WHERE source = ?'; params.push(source); }
    return (this.db.prepare(sql).all(...params) as any[]).map(r => r.id);
  }

  getDocumentSourceIds(source: string): Map<string, string> {
    const rows = this.db.prepare('SELECT id, source_id FROM documents WHERE source = ?').all(source) as any[];
    const map = new Map<string, string>();
    for (const row of rows) map.set(row.id, row.source_id);
    return map;
  }

  getDocumentSyncInfo(source: string): Map<string, { source_id: string; last_synced: string }> {
    const rows = this.db.prepare('SELECT id, source_id, last_synced FROM documents WHERE source = ?').all(source) as any[];
    const map = new Map();
    for (const row of rows) map.set(row.source_id, { source_id: row.source_id, last_synced: row.last_synced });
    return map;
  }

  /**
   * 按 source_id LIKE 模式过滤文档（用于 P0-3 lint_duplicates 等按路径前缀分组的场景）。
   * pattern 示例: "%/wiki/concepts/%"
   */
  getDocumentsByPathLike(pattern: string, source: string = 'local'): Document[] {
    const rows = this.db.prepare(
      'SELECT * FROM documents WHERE source = ? AND source_id LIKE ? ORDER BY source_id ASC'
    ).all(source, pattern) as any[];
    return rows.map(row => ({
      id: row.id, source: row.source, source_id: row.source_id, title: row.title,
      content: row.content, metadata: JSON.parse(row.metadata), last_synced: row.last_synced,
    }));
  }

  getStats(): Record<string, number> {
    const rows = this.db.prepare('SELECT source, COUNT(*) as count FROM documents GROUP BY source').all() as any[];
    const stats: Record<string, number> = {};
    for (const row of rows) stats[row.source] = row.count;
    stats['_chunks_total'] = (this.db.prepare('SELECT COUNT(*) as cnt FROM chunks').get() as any).cnt;
    const emb = this.getEmbeddingStats();
    stats['_chunks_with_embedding'] = emb.withEmbedding;
    return stats;
  }

  close(): void { this.db.close(); }
}
