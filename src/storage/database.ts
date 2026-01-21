import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { Document, SearchFilters } from '../types.js';

/**
 * 数据库管理类
 * 负责文档的持久化存储和检索
 */
export class KnowledgeDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    // 确保数据目录存在
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.initialize();
  }

  /**
   * 初始化数据库表结构
   */
  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT NOT NULL,
        last_synced TEXT NOT NULL,
        UNIQUE(source, source_id)
      );

      CREATE INDEX IF NOT EXISTS idx_source ON documents(source);
      CREATE INDEX IF NOT EXISTS idx_title ON documents(title);
      CREATE INDEX IF NOT EXISTS idx_last_synced ON documents(last_synced);

      -- 全文搜索表
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        id UNINDEXED,
        title,
        content,
        content=documents,
        content_rowid=rowid
      );

      -- 全文搜索触发器
      CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
        INSERT INTO documents_fts(rowid, id, title, content)
        VALUES (new.rowid, new.id, new.title, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
        DELETE FROM documents_fts WHERE rowid = old.rowid;
      END;

      CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
        UPDATE documents_fts SET title = new.title, content = new.content
        WHERE rowid = new.rowid;
      END;
    `);
  }

  /**
   * 插入或更新文档
   * @param doc 文档对象
   */
  upsertDocument(doc: Document): void {
    const stmt = this.db.prepare(`
      INSERT INTO documents (id, source, source_id, title, content, metadata, last_synced)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, source_id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        metadata = excluded.metadata,
        last_synced = excluded.last_synced
    `);

    stmt.run(
      doc.id,
      doc.source,
      doc.source_id,
      doc.title,
      doc.content,
      JSON.stringify(doc.metadata),
      doc.last_synced
    );
  }

  /**
   * 批量插入文档（使用事务）
   * @param docs 文档数组
   */
  batchUpsert(docs: Document[]): void {
    const insert = this.db.transaction((documents: Document[]) => {
      for (const doc of documents) {
        this.upsertDocument(doc);
      }
    });

    insert(docs);
  }

  /**
   * 根据 ID 获取文档
   * @param id 文档 ID
   * @returns 文档对象或 undefined
   */
  getDocument(id: string): Document | undefined {
    const stmt = this.db.prepare('SELECT * FROM documents WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) return undefined;

    return {
      id: row.id,
      source: row.source,
      source_id: row.source_id,
      title: row.title,
      content: row.content,
      metadata: JSON.parse(row.metadata),
      last_synced: row.last_synced,
    };
  }

  /**
   * 全文搜索文档
   * @param query 搜索关键词
   * @param filters 过滤条件
   * @param limit 返回数量限制
   * @returns 文档数组
   */
  searchDocuments(query: string, filters?: SearchFilters, limit: number = 20): Document[] {
    let sql = `
      SELECT d.* FROM documents d
      JOIN documents_fts fts ON d.rowid = fts.rowid
      WHERE documents_fts MATCH ?
    `;
    const params: any[] = [query];

    if (filters?.source) {
      sql += ' AND d.source = ?';
      params.push(filters.source);
    }

    sql += ' ORDER BY rank LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      source: row.source,
      source_id: row.source_id,
      title: row.title,
      content: row.content,
      metadata: JSON.parse(row.metadata),
      last_synced: row.last_synced,
    }));
  }

  /**
   * 获取所有文档
   * @param source 可选：按来源筛选
   * @param limit 返回数量限制
   * @returns 文档数组
   */
  getAllDocuments(source?: string, limit: number = 100): Document[] {
    let sql = 'SELECT * FROM documents';
    const params: any[] = [];

    if (source) {
      sql += ' WHERE source = ?';
      params.push(source);
    }

    sql += ' ORDER BY last_synced DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      source: row.source,
      source_id: row.source_id,
      title: row.title,
      content: row.content,
      metadata: JSON.parse(row.metadata),
      last_synced: row.last_synced,
    }));
  }

  /**
   * 删除文档
   * @param id 文档 ID
   */
  deleteDocument(id: string): void {
    const stmt = this.db.prepare('DELETE FROM documents WHERE id = ?');
    stmt.run(id);
  }

  /**
   * 获取统计信息
   * @returns 各来源的文档数量
   */
  getStats(): Record<string, number> {
    const stmt = this.db.prepare('SELECT source, COUNT(*) as count FROM documents GROUP BY source');
    const rows = stmt.all() as any[];

    const stats: Record<string, number> = {};
    for (const row of rows) {
      stats[row.source] = row.count;
    }

    return stats;
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close();
  }
}
