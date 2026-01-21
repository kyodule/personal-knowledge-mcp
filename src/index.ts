#!/usr/bin/env node

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { KnowledgeMCPServer } from './server.js';
import { LocalCrawler } from './crawlers/local-crawler.js';
import { KnowledgeDatabase } from './storage/database.js';
import { Config } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 日志文件路径
const LOG_FILE = path.resolve(__dirname, '../mcp-server.log');

/**
 * 写入日志到文件
 */
function log(message: string): void {
  try {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    fsSync.appendFileSync(LOG_FILE, logMessage);
  } catch (error) {
    // 静默失败，避免干扰 stdio
  }
}

/**
 * 加载配置文件
 */
async function loadConfig(): Promise<Config> {
  // 优先使用当前工作目录的配置文件
  let configPath = path.resolve(process.cwd(), 'config.json');

  // 如果当前目录没有，尝试使用脚本所在目录的配置文件
  if (!fsSync.existsSync(configPath)) {
    // 脚本在 dist/ 下，配置文件在上一级
    configPath = path.resolve(__dirname, '../config.json');
    log(`当前目录没有 config.json，使用项目根目录: ${configPath}`);
  }

  try {
    const data = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(data) as Config;

    // 将相对路径转换为绝对路径
    if (config.database && config.database.path) {
      if (!path.isAbsolute(config.database.path)) {
        const configDir = path.dirname(configPath);
        const originalPath = config.database.path;
        config.database.path = path.resolve(configDir, config.database.path);
        log(`数据库路径转换: ${originalPath} -> ${config.database.path}`);
      }
    }

    log(`配置加载成功: ${configPath}`);
    return config;
  } catch (error) {
    log(`无法加载配置文件: ${configPath} - ${error}`);
    process.exit(1);
  }
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  const config = await loadConfig();

  // 处理命令行参数
  if (args.includes('--index') || args.includes('-i')) {
    // 手动索引模式 - 使用 console.log 显示进度
    console.log('开始索引本地文档...');

    const database = new KnowledgeDatabase(config.database.path);
    const crawler = new LocalCrawler(
      database,
      config.local.watch_paths,
      config.local.file_extensions,
      config.local.exclude_patterns,
      console.log  // 传入 console.log 作为 logger
    );

    const count = await crawler.indexAll();
    console.log(`\n索引完成！共处理 ${count} 个文档`);

    const stats = database.getStats();
    console.log('\n数据库统计:');
    for (const [source, docCount] of Object.entries(stats)) {
      console.log(`  ${source}: ${docCount} 个文档`);
    }

    database.close();
    process.exit(0);
  } else if (args.includes('--help') || args.includes('-h')) {
    // 帮助信息
    console.log(`
Personal Knowledge MCP Server

用法:
  npm start              启动 MCP 服务器
  npm run index          索引本地文档
  npm run sync           同步所有文档源

选项:
  --index, -i            索引本地文档
  --help, -h             显示帮助信息

配置文件: config.json
    `);
    process.exit(0);
  } else {
    // 默认: 启动 MCP Server
    log('启动 MCP Server 模式');
    const server = new KnowledgeMCPServer(config);

    // 优雅退出
    process.on('SIGINT', async () => {
      log('收到 SIGINT 信号，正在关闭服务器...');
      await server.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      log('收到 SIGTERM 信号，正在关闭服务器...');
      await server.close();
      process.exit(0);
    });

    await server.start();
  }
}

main().catch((error) => {
  log(`致命错误: ${error}`);
  process.exit(1);
});
