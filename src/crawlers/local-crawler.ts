import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { glob } from 'glob';
import chokidar from 'chokidar';
import { Document } from '../types.js';
import { FileParser } from '../utils/file-parser.js';
import { KnowledgeDatabase } from '../storage/database.js';

/**
 * 本地文档爬虫
 * 支持增量索引和死文档清理
 */
export class LocalCrawler {
  private parser: FileParser;
  private database: KnowledgeDatabase;
  private watchPaths: string[];
  private fileExtensions: string[];
  private excludePatterns: string[];
  private watcher?: any;
  private log: (message: string) => void;

  constructor(
    database: KnowledgeDatabase,
    watchPaths: string[],
    fileExtensions: string[],
    excludePatterns: string[],
    logger?: (message: string) => void
  ) {
    this.parser = new FileParser();
    this.database = database;
    this.watchPaths = watchPaths;
    this.fileExtensions = fileExtensions;
    this.excludePatterns = excludePatterns;
    this.log = logger || (() => {});
  }

  /**
   * 生成文件路径对应的文档 ID
   */
  static fileId(filePath: string): string {
    return crypto.createHash('md5').update(filePath).digest('hex');
  }

  /**
   * 扫描并索引所有文档（增量模式）
   * 只处理新文件和修改过的文件，并清理已删除的文件
   */
  async indexAll(): Promise<number> {
    this.log('开始扫描本地文档...');

    // 获取数据库中已有的本地文档信息
    const existingDocs = this.database.getDocumentSyncInfo('local');
    const seenPaths = new Set<string>();

    const documents: Document[] = [];
    let skippedCount = 0;

    for (const watchPath of this.watchPaths) {
      this.log(`扫描目录: ${watchPath}`);

      try {
        await fs.access(watchPath);
      } catch {
        this.log(`路径不存在，跳过: ${watchPath}`);
        continue;
      }

      const patterns = this.fileExtensions.map(ext => `${watchPath}/**/*${ext}`);

      for (const pattern of patterns) {
        const files = await glob(pattern, {
          ignore: this.excludePatterns,
          nodir: true,
          absolute: true,
        });

        for (const filePath of files) {
          seenPaths.add(filePath);

          try {
            // 增量检查：比较文件 mtime 和 last_synced
            const stats = await fs.stat(filePath);
            const existing = existingDocs.get(filePath);

            if (existing) {
              const lastSynced = new Date(existing.last_synced).getTime();
              const mtime = stats.mtime.getTime();
              if (mtime <= lastSynced) {
                skippedCount++;
                continue;
              }
            }

            const doc = await this.processFile(filePath, stats);
            documents.push(doc);
          } catch (error) {
            this.log(`处理文件失败 ${filePath}: ${error}`);
          }
        }
      }
    }

    // 批量写入变更的文档
    if (documents.length > 0) {
      this.log(`正在保存 ${documents.length} 个新/变更文档到数据库...`);
      this.database.batchUpsert(documents);
    }

    if (skippedCount > 0) {
      this.log(`跳过 ${skippedCount} 个未变更文档`);
    }

    // 死文档清理：删除数据库中存在但文件系统中已不存在的文档
    const staleIds: string[] = [];
    for (const [filePath] of existingDocs) {
      if (!seenPaths.has(filePath)) {
        staleIds.push(LocalCrawler.fileId(filePath));
        this.log(`清理已删除文件: ${filePath}`);
      }
    }

    if (staleIds.length > 0) {
      this.database.batchDeleteDocuments(staleIds);
      this.log(`清理了 ${staleIds.length} 个不存在的文档`);
    }

    const totalInDb = documents.length + (existingDocs.size - staleIds.length);
    this.log(`索引完成！新增/更新 ${documents.length}，清理 ${staleIds.length}，数据库共 ~${totalInDb} 个本地文档`);

    return documents.length;
  }

  /**
   * 处理单个文件
   */
  private async processFile(filePath: string, stats?: import('fs').Stats): Promise<Document> {
    const content = await this.parser.parseFile(filePath);
    if (!stats) {
      stats = await fs.stat(filePath);
    }
    const title = this.parser.extractTitle(filePath, content);
    const id = LocalCrawler.fileId(filePath);

    return {
      id,
      source: 'local',
      source_id: filePath,
      title,
      content: this.truncateContent(content),
      metadata: {
        file_path: filePath,
        file_size: stats.size,
        created_at: stats.birthtime.toISOString(),
        updated_at: stats.mtime.toISOString(),
      },
      last_synced: new Date().toISOString(),
    };
  }

  private truncateContent(content: string): string {
    const MAX_LENGTH = 100000;
    if (content.length > MAX_LENGTH) {
      return content.substring(0, MAX_LENGTH) + '\n\n... (内容已截断)';
    }
    return content;
  }

  startWatching(): void {
    if (this.watcher) {
      this.log('文件监听已启动');
      return;
    }

    this.log('启动文件监听...');

    this.watcher = chokidar.watch(this.watchPaths, {
      ignored: this.excludePatterns,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100,
      },
    });

    this.watcher
      .on('add', async (filePath: string) => {
        if (this.shouldProcess(filePath)) {
          this.log(`新文件: ${filePath}`);
          try {
            const doc = await this.processFile(filePath);
            this.database.upsertDocument(doc);
          } catch (error) {
            this.log(`处理新文件失败 ${filePath}: ${error}`);
          }
        }
      })
      .on('change', async (filePath: string) => {
        if (this.shouldProcess(filePath)) {
          this.log(`文件变更: ${filePath}`);
          try {
            const doc = await this.processFile(filePath);
            this.database.upsertDocument(doc);
          } catch (error) {
            this.log(`处理变更文件失败 ${filePath}: ${error}`);
          }
        }
      })
      .on('unlink', (filePath: string) => {
        if (this.shouldProcess(filePath)) {
          this.log(`文件删除: ${filePath}`);
          const id = LocalCrawler.fileId(filePath);
          this.database.deleteDocument(id);
        }
      })
      .on('error', (error: Error) => {
        this.log(`文件监听错误: ${error}`);
      });

    this.log('文件监听已启动');
  }

  async stopWatching(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = undefined;
      this.log('文件监听已停止');
    }
  }

  private shouldProcess(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.fileExtensions.includes(ext);
  }
}
