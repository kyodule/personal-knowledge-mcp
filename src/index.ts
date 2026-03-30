#!/usr/bin/env node

// Fix onnxruntime-node mutex crash on Node.js v24+
// MUST run before any module that transitively loads onnxruntime-node
process.env.OMP_NUM_THREADS = '1';

// All imports are dynamic to ensure env var is set first
async function main() {
  const fs = await import('fs/promises');
  const fsSync = await import('fs');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const { KnowledgeMCPServer } = await import('./server.js');
  const { LocalCrawler } = await import('./crawlers/local-crawler.js');
  const { KnowledgeDatabase } = await import('./storage/database.js');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const LOG_FILE = path.resolve(__dirname, '../mcp-server.log');

  function log(message: string): void {
    try {
      const timestamp = new Date().toISOString();
      fsSync.appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
    } catch { /* silent */ }
  }

  async function loadConfig() {
    let configPath = path.resolve(process.cwd(), 'config.json');
    if (!fsSync.existsSync(configPath)) {
      configPath = path.resolve(__dirname, '../config.json');
      log(`当前目录没有 config.json，使用项目根目录: ${configPath}`);
    }
    try {
      const data = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(data);
      if (config.database?.path && !path.isAbsolute(config.database.path)) {
        config.database.path = path.resolve(path.dirname(configPath), config.database.path);
      }
      log(`配置加载成功: ${configPath}`);
      return config;
    } catch (error) {
      log(`无法加载配置文件: ${configPath} - ${error}`);
      process.exit(1);
    }
  }

  const args = process.argv.slice(2);
  const config = await loadConfig();

  if (args.includes('--index') || args.includes('-i')) {
    console.log('开始索引本地文档...');
    const database = new KnowledgeDatabase(config.database.path);
    const crawler = new LocalCrawler(
      database, config.local.watch_paths, config.local.file_extensions,
      config.local.exclude_patterns, console.log
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

  } else if (args.includes('--embed') || args.includes('-e')) {
    console.log('开始生成文档 embedding...');
    const database = new KnowledgeDatabase(config.database.path);
    const stats = database.getEmbeddingStats();
    console.log(`当前状态: ${stats.withEmbedding}/${stats.total} chunks 已有 embedding，${stats.without} 待处理`);

    if (stats.without === 0) {
      console.log('所有 chunks 已有 embedding，无需处理');
      database.close();
      process.exit(0);
    }

    const BATCH_SIZE = 50;
    let processed = 0;
    const { embedBatch } = await import('./utils/embedder.js');
    while (true) {
      const chunks = database.getChunksWithoutEmbedding(BATCH_SIZE);
      if (chunks.length === 0) break;
      const texts = chunks.map(c => c.content.substring(0, 512));
      const embeddings = await embedBatch(texts);
      const items = chunks.map((chunk, i) => ({ chunkId: chunk.id, embedding: embeddings[i] }));
      database.batchInsertEmbeddings(items);
      processed += items.length;
      console.log(`已处理 ${processed}/${stats.without} chunks...`);
    }
    const finalStats = database.getEmbeddingStats();
    console.log(`\nEmbedding 生成完成！${finalStats.withEmbedding}/${finalStats.total} chunks 已有 embedding`);
    database.close();
    process.exit(0);

  } else if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Personal Knowledge MCP Server

用法:
  npm start              启动 MCP 服务器
  npm run index          索引本地文档
  npm run embed          生成文档 embedding（用于混合搜索）
  npm run sync           同步所有文档源

选项:
  --index, -i            索引本地文档
  --embed, -e            生成文档 embedding（用于混合搜索）
  --help, -h             显示帮助信息

配置文件: config.json
    `);
    process.exit(0);

  } else {
    log('启动 MCP Server 模式');
    const server = new KnowledgeMCPServer(config);
    process.on('SIGINT', async () => { log('收到 SIGINT'); await server.close(); process.exit(0); });
    process.on('SIGTERM', async () => { log('收到 SIGTERM'); await server.close(); process.exit(0); });
    await server.start();
  }
}

main().catch((error) => {
  console.error(`致命错误: ${error}`);
  process.exit(1);
});
