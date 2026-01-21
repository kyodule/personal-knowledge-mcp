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
 * 负责扫描本地文件系统并索引文档
 */
export class LocalCrawler {
  private parser: FileParser;
  private database: KnowledgeDatabase;
  private watchPaths: string[];
  private fileExtensions: string[];
  private excludePatterns: string[];
  private watcher?: any; // chokidar.FSWatcher
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
    // 如果提供了 logger 就用，否则静默
    this.log = logger || (() => {});
  }

  /**
   * 扫描并索引所有文档
   * @returns 索引的文档数量
   */
  async indexAll(): Promise<number> {
    this.log('开始扫描本地文档...');
    const documents: Document[] = [];

    for (const watchPath of this.watchPaths) {
      this.log(`扫描目录: ${watchPath}`);

      // 检查路径是否存在
      try {
        await fs.access(watchPath);
      } catch {
        this.log(`路径不存在，跳过: ${watchPath}`);
        continue;
      }

      // 构建 glob 模式
      const patterns = this.fileExtensions.map(
        ext => `${watchPath}/**/*${ext}`
      );

      for (const pattern of patterns) {
        const files = await glob(pattern, {
          ignore: this.excludePatterns,
          nodir: true,
          absolute: true,
        });

        this.log(`找到 ${files.length} 个 ${path.extname(pattern)} 文件`);

        for (const filePath of files) {
          try {
            const doc = await this.processFile(filePath);
            documents.push(doc);
          } catch (error) {
            this.log(`处理文件失败 ${filePath}: ${error}`);
          }
        }
      }
    }

    // 批量插入数据库
    this.log(`正在保存 ${documents.length} 个文档到数据库...`);
    this.database.batchUpsert(documents);
    this.log('索引完成！');

    return documents.length;
  }

  /**
   * 处理单个文件
   * @param filePath 文件路径
   * @returns 文档对象
   */
  private async processFile(filePath: string): Promise<Document> {
    const content = await this.parser.parseFile(filePath);
    const stats = await fs.stat(filePath);
    const title = this.parser.extractTitle(filePath, content);

    // 生成文档 ID（基于文件路径的哈希）
    const id = crypto.createHash('md5').update(filePath).digest('hex');

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

  /**
   * 截断过长的内容（避免数据库过大）
   * @param content 原始内容
   * @returns 截断后的内容
   */
  private truncateContent(content: string): string {
    const MAX_LENGTH = 100000; // 10万字符
    if (content.length > MAX_LENGTH) {
      return content.substring(0, MAX_LENGTH) + '\n\n... (内容已截断)';
    }
    return content;
  }

  /**
   * 启动文件监听（实时同步）
   */
  startWatching(): void {
    if (this.watcher) {
      this.log('文件监听已启动');
      return;
    }

    this.log('启动文件监听...');

    this.watcher = chokidar.watch(this.watchPaths, {
      ignored: this.excludePatterns,
      persistent: true,
      ignoreInitial: true, // 忽略初始扫描
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
          const id = crypto.createHash('md5').update(filePath).digest('hex');
          this.database.deleteDocument(id);
        }
      })
      .on('error', (error: Error) => {
        this.log(`文件监听错误: ${error}`);
      });

    this.log('文件监听已启动');
  }

  /**
   * 停止文件监听
   */
  async stopWatching(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = undefined;
      this.log('文件监听已停止');
    }
  }

  /**
   * 判断文件是否应该被处理
   * @param filePath 文件路径
   * @returns 是否处理
   */
  private shouldProcess(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.fileExtensions.includes(ext);
  }
}
