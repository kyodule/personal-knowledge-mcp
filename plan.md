# Personal Knowledge MCP Server 完整方案

## 项目概述

**目标**：构建一个个人知识库 MCP Server，支持本地文档、飞书、企业微信文档的统一索引和检索，通过 MCP 协议为 AI 客户端（如 Cherry Studio）提供知识增强能力。

**核心价值**：
- 将分散的文档统一管理
- 通过 AI 快速检索和理解文档内容
- 支持语义搜索和精确搜索
- 可扩展的 RAG（检索增强生成）架构

---

## 技术架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│               Cherry Studio (AI 客户端)                  │
│  - 接收用户问题                                           │
│  - 决定是否调用知识库工具                                  │
│  - 基于检索结果生成答案                                    │
└───────────────────────┬─────────────────────────────────┘
                        │ MCP 协议 (JSON-RPC over stdio)
                        ↓
┌─────────────────────────────────────────────────────────┐
│            Personal Knowledge MCP Server                 │
│  - 提供检索工具 (search, get, list, stats)              │
│  - 处理多数据源                                           │
│  - 日志写入文件（不污染 stdio）                           │
└───────────────────────┬─────────────────────────────────┘
                        │
            ┌───────────┼───────────┬─────────────┐
            ↓           ↓           ↓             ↓
    ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
    │本地文档   │  │飞书文档   │  │企微文档   │  │向量数据库 │
    │Crawler   │  │Crawler   │  │Crawler   │  │(可选)    │
    └──────────┘  └──────────┘  └──────────┘  └──────────┘
            │           │           │             │
            └───────────┴───────────┴─────────────┘
                        ↓
            ┌─────────────────────────┐
            │  SQLite 数据库 + FTS5    │
            │  - documents 表          │
            │  - 全文索引              │
            │  - 元数据管理            │
            └─────────────────────────┘
```

### MCP 协议原理

MCP (Model Context Protocol) 基于 **JSON-RPC 2.0**，通过 **stdin/stdout** 通信：

1. **初始化握手**
```json
// Client → Server
{"jsonrpc":"2.0","method":"initialize","params":{...},"id":1}

// Server → Client
{"jsonrpc":"2.0","result":{"capabilities":{"tools":{}}},"id":1}
```

2. **列出工具**
```json
// Client → Server
{"jsonrpc":"2.0","method":"tools/list","id":2}

// Server → Client
{"jsonrpc":"2.0","result":{"tools":[...]},"id":2}
```

3. **调用工具**
```json
// Client → Server
{"jsonrpc":"2.0","method":"tools/call","params":{"name":"search_documents","arguments":{...}},"id":3}

// Server → Client
{"jsonrpc":"2.0","result":{"content":[...]},"id":3}
```

**关键点**：
- 所有日志必须写入文件，不能污染 stdout（否则破坏 JSON-RPC）
- 使用 `@modelcontextprotocol/sdk` 简化实现
- `StdioServerTransport` 处理 stdin/stdout 通信

---

## Phase 1: 本地文档索引（已完成 ✅）

### 1.1 支持的文件格式

| 格式 | 状态 | 解析库 | 说明 |
|-----|------|--------|------|
| `.txt` | ✅ | fs | 原生支持 |
| `.md` | ✅ | fs | 原生支持 |
| `.pdf` | ✅ | pdf-parse | 提取纯文本 |
| `.docx` | ✅ | mammoth | 提取纯文本 |
| `.pptx` | ✅ | adm-zip + xml2js | 解压 ZIP，解析 XML |

### 1.2 文件解析实现

#### PPTX 解析原理

PPTX 本质是一个 ZIP 压缩包：

```
example.pptx
├── [Content_Types].xml
├── _rels/
├── docProps/
└── ppt/
    ├── presentation.xml
    ├── slides/
    │   ├── slide1.xml    ← 幻灯片 1
    │   ├── slide2.xml    ← 幻灯片 2
    │   └── slide3.xml    ← 幻灯片 3
    └── slideLayouts/
```

**解析流程**：
```typescript
1. 用 AdmZip 解压 PPTX
   ↓
2. 找到所有 ppt/slides/slide*.xml
   ↓
3. 解析 XML，递归查找所有 <a:t> 标签（文本节点）
   ↓
4. 提取文本内容
   ↓
5. 按幻灯片顺序拼接，用 --- 分隔
```

**核心代码**：
```typescript
private async parsePPTX(filePath: string): Promise<string> {
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();
  const textContents: string[] = [];

  for (const entry of entries) {
    if (entry.entryName.match(/ppt\/slides\/slide\d+\.xml/)) {
      const xml = entry.getData().toString('utf8');
      const text = await this.extractTextFromSlideXML(xml);
      textContents.push(text);
    }
  }

  return textContents.join('\n\n---\n\n');
}
```

### 1.3 数据存储设计

#### 数据库结构

**documents 表**：
```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,           -- MD5(文件路径) 或 source_type + id
  source TEXT NOT NULL,          -- 'local' | 'feishu' | 'wecom'
  source_id TEXT NOT NULL,       -- 原始文件路径或文档ID
  title TEXT NOT NULL,           -- 文档标题
  content TEXT NOT NULL,         -- 文档内容（纯文本/Markdown）
  metadata TEXT NOT NULL,        -- JSON 字符串
  last_synced TEXT NOT NULL,     -- 最后同步时间
  UNIQUE(source, source_id)
);
```

**FTS5 全文索引**：
```sql
CREATE VIRTUAL TABLE documents_fts USING fts5(
  id UNINDEXED,
  title,      -- 可搜索
  content,    -- 可搜索
  content=documents,
  content_rowid=rowid
);
```

**搜索实现**：
```typescript
searchDocuments(query: string) {
  return this.db.prepare(`
    SELECT d.* FROM documents d
    JOIN documents_fts fts ON d.rowid = fts.rowid
    WHERE documents_fts MATCH ?
    ORDER BY rank
    LIMIT 20
  `).all(query);
}
```

### 1.4 关键问题修复

#### 问题 1: 数据库路径问题

**现象**：Cherry Studio 调用时，相对路径 `./data/knowledge.db` 找不到

**解决**：
```typescript
// 自动转换为绝对路径
if (!path.isAbsolute(config.database.path)) {
  const configDir = path.dirname(configPath);
  config.database.path = path.resolve(configDir, config.database.path);
}
```

#### 问题 2: stderr 污染问题

**现象**：`console.error()` 干扰 MCP 的 stdio 通信

**解决**：
```typescript
// 所有日志写入文件
const LOG_FILE = path.resolve(__dirname, '../mcp-server.log');

function log(message: string) {
  const timestamp = new Date().toISOString();
  fsSync.appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
}

// MCP Server 模式：静默运行
// 手动索引模式：输出到 console.log（用户需要看进度）
```

### 1.5 MCP 工具接口

提供的工具：

1. **search_documents** - 搜索文档
   ```json
   {
     "query": "TypeScript 泛型",
     "source": "local",  // 可选
     "limit": 20
   }
   ```

2. **get_document** - 获取完整文档
   ```json
   {
     "document_id": "abc123"
   }
   ```

3. **list_documents** - 列出文档
   ```json
   {
     "source": "local",  // 可选
     "limit": 50
   }
   ```

4. **get_stats** - 统计信息
   ```json
   {}
   ```

5. **sync_local_documents** - 手动同步本地文档
   ```json
   {}
   ```

---

## Phase 2: 飞书文档集成（设计中）

### 2.1 前置条件

**必须满足**：
- ✅ 企业管理员权限（或管理员授权）
- ✅ 创建飞书自建应用
- ✅ 获取以下权限：
  - `docx:document` - 文档读取
  - `drive:drive` - 云空间访问
  - `wiki:wiki` - 知识库访问

**限制**：
- ⚠️ 个人版飞书可能无法创建应用
- ⚠️ 企业版需要管理员审批
- ⚠️ 权限范围受企业策略限制

### 2.2 支持的文档类型

| 文档类型 | API 支持 | 导出格式 | 优先级 |
|---------|---------|---------|--------|
| 飞书文档 | ✅ 完整支持 | Markdown | 🔴 Phase 2.1 |
| 电子表格 | ✅ 部分支持 | CSV | 🟡 Phase 2.2 |
| 多维表格 | ✅ API 支持 | JSON | 🟡 Phase 2.2 |
| 思维导图 | ❌ 不支持 | - | ❌ 跳过 |
| 白板 | ❌ 不支持 | - | ❌ 跳过 |

### 2.3 OAuth 授权方案（推荐）

**架构**：
```
用户
  ↓ 1. 运行 npm run feishu:auth
本地临时 HTTP 服务器 (http://localhost:3000)
  ↓ 2. 打开浏览器
飞书 OAuth 页面
  ↓ 3. 用户登录并授权
飞书服务器回调
  ↓ 4. 返回 code
本地服务器用 code 换取 access_token
  ↓ 5. 保存 token（加密存储）
开始同步文档
```

**配置流程**（用户视角）：
```bash
# 1. 配置 app_id 和 app_secret
vim config.json

# 2. 首次授权
npm run feishu:auth
# → 浏览器自动打开
# → 飞书登录并授权
# → 回到终端：✅ 授权成功！

# 3. 首次同步
npm run feishu:sync
# → 找到 50 个文档
# → 同步完成！
```

**关键 API**：

1. **获取 Access Token**
```http
POST https://open.feishu.cn/open-apis/authen/v1/access_token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "code": "xxxxx",
  "app_id": "...",
  "app_secret": "..."
}
```

2. **获取文档列表**
```http
GET https://open.feishu.cn/open-apis/drive/v1/files?folder_token=xxx
Authorization: Bearer {access_token}
```

3. **导出文档为 Markdown**
```http
POST https://open.feishu.cn/open-apis/docx/v1/documents/{doc_id}/raw_content
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "lang": 0  // 0=中文
}
```

### 2.4 同步策略

**策略 1：全量同步（首次）**
```typescript
async function fullSync() {
  // 1. 获取所有空间
  const spaces = await feishuAPI.getDriveSpaces();

  // 2. 遍历空间，获取文档列表
  for (const space of spaces) {
    const docs = await feishuAPI.listDocs(space.token);

    // 3. 下载每个文档
    for (const doc of docs) {
      const content = await feishuAPI.exportDoc(doc.token, 'markdown');
      database.upsertDocument({
        id: `feishu_${doc.token}`,
        source: 'feishu',
        source_id: doc.token,
        title: doc.title,
        content: content,
        metadata: {
          feishu_url: doc.url,
          feishu_owner: doc.owner,
          updated_at: doc.edit_time
        }
      });
    }
  }
}
```

**策略 2：增量同步（定期）**
```typescript
async function incrementalSync() {
  const lastSyncTime = getLastSyncTime();

  // 只同步有变化的文档
  const changedDocs = await feishuAPI.listRecentDocs({
    start_time: lastSyncTime
  });

  for (const doc of changedDocs) {
    const content = await feishuAPI.exportDoc(doc.token, 'markdown');
    database.upsertDocument({...});
  }
}
```

**同步频率**：
- **手动触发**：`npm run feishu:sync`
- **自动同步**：每 4 小时一次（可配置）
- **Cherry Studio 触发**：提供 `sync_feishu_documents` 工具

### 2.5 配置文件扩展

```json
{
  "feishu": {
    "enabled": true,
    "app_id": "cli_xxxxx",
    "app_secret": "xxxxx",

    // OAuth 配置
    "redirect_uri": "http://localhost:3000/callback",
    "scopes": ["docx:document", "drive:drive", "wiki:wiki"],

    // 同步配置
    "sync_interval": 14400,  // 4小时（秒）
    "auto_sync": true,

    // 过滤配置
    "include_spaces": [],    // 空=所有，或指定空间ID
    "exclude_spaces": [],
    "only_my_docs": false,   // 只同步我的文档

    // 存储配置
    "token_file": "./data/feishu_token.json"  // 加密存储
  }
}
```

### 2.6 安全考虑

**Token 加密存储**：
```typescript
import crypto from 'crypto';

function encryptToken(token: string, key: string): string {
  const cipher = crypto.createCipher('aes-256-cbc', key);
  return cipher.update(token, 'utf8', 'hex') + cipher.final('hex');
}

// 存储
fs.writeFileSync('./data/feishu_token.json', JSON.stringify({
  access_token: encryptToken(token, process.env.ENCRYPTION_KEY),
  expires_at: Date.now() + 7200 * 1000
}));
```

**权限最小化**：
- ✅ 只申请读权限（不需要写权限）
- ✅ 用户授权（不是企业全局）
- ✅ 定期清理本地缓存

### 2.7 潜在问题与解决

| 问题 | 解决方案 |
|-----|---------|
| Token 过期 | 自动刷新机制 |
| API 限流 | 速率限制 + 指数退避重试 |
| 大文档 | 内容截断（10万字符） |
| 权限不足 | 跳过无权限文档 |
| 网络异常 | 重试机制 + 日志记录 |

### 2.8 实现路线图

**Phase 2.1：基础功能（2-3天）**
- [ ] OAuth 授权流程
- [ ] 获取文档列表
- [ ] 下载飞书文档（Markdown）
- [ ] 存入数据库
- [ ] 手动同步命令

**Phase 2.2：自动同步（1天）**
- [ ] Token 自动刷新
- [ ] 增量同步
- [ ] 定时任务
- [ ] MCP 工具：`sync_feishu_documents`

**Phase 2.3：高级功能（可选）**
- [ ] 支持电子表格
- [ ] 支持多维表格
- [ ] 过滤器
- [ ] 删除检测

---

## Phase 3: 企业微信集成（规划中）

### 3.1 技术难点

**企业微信文档生态复杂**：
- 可能是腾讯文档（有独立 API）
- 可能是微盘文件（下载接口）
- 可能是第三方集成

**建议策略**：
1. **评估 API 可用性** - 先调研企业微信 API 文档
2. **如果 API 不完善** → 采用手动导出方案：
   - 定期手动导出到某个文件夹
   - 程序监听该文件夹，自动索引
3. **优先级低** - 飞书更常用，先做 Phase 2

---

## Phase 4: 向量搜索与 RAG（可选）

### 4.1 传统搜索 vs 向量搜索

| 特性 | 传统搜索（FTS5） | 向量搜索 |
|-----|----------------|---------|
| 搜索方式 | 关键词匹配 | 语义相似度 |
| 理解能力 | 无（字面匹配） | 强（理解意图） |
| 跨语言 | ❌ | ✅ |
| 同义词 | ❌ | ✅ |
| 速度 | 快 | 慢 |
| 适用场景 | 精确查询 | 模糊问题 |

**示例对比**：

**场景**：用户搜索"如何在 TS 中写通用代码"

- **传统搜索**：❌ 找不到（因为文档里没有"TS"、"通用"）
- **向量搜索**：✅ 找到"TypeScript 泛型"（理解了意图）

### 4.2 向量化原理

**Embedding**：将文本转换为数字向量

```
"TypeScript 泛型" → [0.12, -0.45, 0.78, ..., 0.33]  (1536维)
"TS 通用代码"    → [0.15, -0.42, 0.75, ..., 0.30]  (1536维)
"Python 装饰器" → [-0.32, 0.67, -0.21, ..., 0.89] (1536维)

相似度:
  "TypeScript 泛型" vs "TS 通用代码" = 0.89  (高度相似)
  "TypeScript 泛型" vs "Python 装饰器" = 0.23  (不相似)
```

**常用模型**：
- OpenAI: `text-embedding-ada-002`
- 本地: `nomic-embed-text` (通过 Ollama)
- 中文: `bge-large-zh`

### 4.3 向量数据库选型

| 数据库 | 类型 | 优点 | 缺点 |
|--------|-----|------|------|
| Pinecone | 云服务 | 简单、托管 | 收费 |
| ChromaDB | 本地 | 开源、易用 | 性能一般 |
| pgvector | PostgreSQL扩展 | 灵活、可靠 | 需要 PG |

**推荐**：ChromaDB（本地运行，零配置）

### 4.4 混合搜索策略（最佳实践）

**策略 1：双路召回 + 重排序**
```typescript
async function hybridSearch(query: string) {
  // 并行执行
  const [keywordResults, semanticResults] = await Promise.all([
    sqliteDB.search(query),              // 关键词搜索
    vectorDB.search(await embed(query))  // 语义搜索
  ]);

  // 合并去重
  const merged = mergeDeduplicate([keywordResults, semanticResults]);

  // 重排序
  return rerank(merged, query);
}
```

**策略 2：先快后慢**
```typescript
async function smartSearch(query: string) {
  // 1. 先用关键词搜索（快）
  const keywordResults = await sqliteDB.search(query);

  // 2. 如果结果太少，再用语义搜索（慢）
  if (keywordResults.length < 5) {
    const semanticResults = await vectorDB.search(query);
    return [...keywordResults, ...semanticResults];
  }

  return keywordResults;
}
```

### 4.5 RAG 架构

**当前架构已经是 RAG**：

```
用户问题
  ↓
Cherry Studio (AI)
  ↓ 判断需要查知识库
调用 MCP search_documents 工具
  ↓
【检索阶段】向量搜索 + 关键词搜索
  ↓
返回相关文档
  ↓
【增强阶段】AI 读取文档内容
  ↓
【生成阶段】AI 基于文档生成答案
  ↓
返回给用户
```

**与传统 RAG 的区别**：

| | 传统 RAG | MCP RAG（我们的） |
|---|---------|-----------------|
| 架构 | 单体服务 | 分布式 |
| 控制权 | 服务端 | AI 客户端 |
| 何时触发 | 每次都触发 | AI 自己判断 |
| 灵活性 | 低 | 高 |

**核心一样**：都是"检索 → 增强 → 生成"

### 4.6 实现示例

```typescript
// 添加向量搜索工具
{
  name: "semantic_search",
  description: "语义搜索（理解意图）",
  inputSchema: {
    query: "自然语言问题"
  }
}

async handleSemanticSearch(args: any) {
  const { query } = args;

  // 1. 向量化查询
  const queryVector = await ollama.embeddings({
    model: 'nomic-embed-text',
    prompt: query
  });

  // 2. 向量搜索
  const results = await chromaDB.query({
    queryEmbeddings: [queryVector.embedding],
    nResults: 10
  });

  return results;
}
```

---

## 配置示例

### config.json（完整版）

```json
{
  "local": {
    "enabled": true,
    "watch_paths": [
      "~/Documents",
      "~/Desktop"
    ],
    "file_extensions": [".txt", ".md", ".pdf", ".docx", ".pptx"],
    "exclude_patterns": [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/build/**"
    ]
  },

  "feishu": {
    "enabled": false,
    "app_id": "",
    "app_secret": "",
    "redirect_uri": "http://localhost:3000/callback",
    "scopes": ["docx:document", "drive:drive", "wiki:wiki"],
    "sync_interval": 14400,
    "auto_sync": true,
    "include_spaces": [],
    "exclude_spaces": [],
    "only_my_docs": false,
    "token_file": "./data/feishu_token.json"
  },

  "wecom": {
    "enabled": false,
    "corp_id": "",
    "secret": "",
    "sync_interval": 14400
  },

  "database": {
    "path": "./data/knowledge.db"
  },

  "vector": {
    "enabled": false,
    "provider": "chromadb",
    "model": "nomic-embed-text",
    "collection": "documents"
  }
}
```

---

## 使用指南

### 安装与配置

```bash
# 1. 安装依赖
cd personal-knowledge-mcp
npm install

# 2. 配置
vim config.json
# 设置 watch_paths

# 3. 构建
npm run build

# 4. 索引本地文档
npm run index
```

### Cherry Studio 配置

```json
{
  "mcpServers": {
    "personal-knowledge": {
      "command": "node",
      "args": ["/path/to/personal-knowledge-mcp/dist/index.js"]
    }
  }
}
```

### 日常使用

```bash
# 手动索引
npm run index

# 飞书授权（首次）
npm run feishu:auth

# 飞书同步
npm run feishu:sync

# 查看日志
tail -f mcp-server.log

# 查看统计
sqlite3 data/knowledge.db "SELECT source, COUNT(*) FROM documents GROUP BY source;"
```

### 在 Cherry Studio 中使用

```
# 搜索
"帮我搜索知识库中关于 TypeScript 的文档"

# 列出文档
"列出我最近更新的 10 个文档"

# 统计
"我的知识库有多少文档？"

# 同步
"同步飞书文档"
```

---

## 技术细节

### 文件结构

```
personal-knowledge-mcp/
├── src/
│   ├── index.ts              # 入口
│   ├── server.ts             # MCP Server
│   ├── types.ts              # 类型定义
│   ├── storage/
│   │   └── database.ts       # SQLite 管理
│   ├── crawlers/
│   │   ├── local-crawler.ts  # 本地文档
│   │   └── feishu-crawler.ts # 飞书文档
│   └── utils/
│       └── file-parser.ts    # 文件解析
├── data/
│   ├── knowledge.db          # 数据库
│   └── feishu_token.json     # Token（加密）
├── dist/                     # 编译输出
├── config.json               # 配置
├── package.json
└── mcp-server.log           # 运行日志
```

### 依赖清单

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.4",
    "better-sqlite3": "^11.7.0",
    "chokidar": "^4.0.3",
    "glob": "^11.0.0",
    "mammoth": "^1.8.0",
    "pdf-parse": "^1.1.1",
    "adm-zip": "^0.5.16",
    "xml2js": "^0.6.2"
  }
}
```

---

## 性能与优化

### 索引性能

- **TXT/MD**: ~1000 文件/秒
- **PDF**: ~10 文件/秒（取决于复杂度）
- **DOCX**: ~50 文件/秒
- **PPTX**: ~30 文件/秒

**优化建议**：
- 使用 `exclude_patterns` 排除大型目录
- 限制文件大小（默认 10 万字符）
- 定期清理数据库

### 搜索性能

- **关键词搜索**：< 50ms（有索引）
- **语义搜索**：500-2000ms（取决于向量数量）
- **混合搜索**：并行执行，取最慢的

---

## 安全与合规

### 数据安全

✅ **本地存储** - 所有数据在本机，不上传云端
✅ **Token 加密** - 敏感信息加密存储
✅ **权限最小化** - 只申请必要的读权限
✅ **日志隔离** - 日志写入文件，不泄露到 stdout

### 企业合规

⚠️ **重要提醒**：
- 确认企业信息安全政策允许导出文档
- 敏感文档建议排除（使用 `exclude_spaces`）
- 定期清理本地缓存
- 不要将 token 文件提交到 Git

---

## 故障排查

### 常见问题

**Q1: Cherry Studio 无法连接？**
- 检查路径是否为绝对路径
- 确认已运行 `npm run build`
- 查看 `mcp-server.log` 日志

**Q2: 搜索不到文档？**
- 确认已运行 `npm run index`
- 检查文件扩展名是否在 `file_extensions` 中
- 尝试不同的关键词

**Q3: 飞书授权失败？**
- 检查 `app_id` 和 `app_secret` 是否正确
- 确认应用已获得必要权限
- 查看浏览器控制台错误

**Q4: PDF 解析警告很多？**
- 这是正常的，某些 PDF 字体格式复杂
- 不影响文本提取
- 如果想跳过 PDF，从 `file_extensions` 中移除 `.pdf`

---

## 未来规划

### 短期（1-2 个月）

- [ ] 完成飞书集成（Phase 2）
- [ ] 企业微信评估（Phase 3）
- [ ] 向量搜索 POC（Phase 4）

### 中期（3-6 个月）

- [ ] 支持更多文件格式（Excel, 思维导图）
- [ ] 文档分块策略（长文档处理）
- [ ] 引用标注（告诉用户答案来自哪个文档）
- [ ] 多轮对话上下文记忆

### 长期（6-12 个月）

- [ ] 图片 OCR（PDF 中的图片文字）
- [ ] 代码仓库索引（GitHub, GitLab）
- [ ] 邮件索引（Gmail, Outlook）
- [ ] Web 页面归档（收藏夹索引）

---

## 贡献指南

### 开发环境

```bash
# 开发模式（自动编译）
npm run dev

# 手动编译
npm run build

# 测试
npm run index
npm start
```

### 添加新的文档源

1. 创建 `src/crawlers/xxx-crawler.ts`
2. 实现 `Crawler` 接口
3. 在 `src/server.ts` 中注册
4. 添加配置到 `config.json`
5. 更新文档

---

## 参考资源

### 官方文档

- [MCP Protocol Spec](https://modelcontextprotocol.io/)
- [飞书开放平台](https://open.feishu.cn/)
- [企业微信 API](https://developer.work.weixin.qq.com/)

### 技术博客

- [Understanding RAG](https://arxiv.org/abs/2005.11401)
- [Vector Databases Explained](https://www.pinecone.io/learn/vector-database/)
- [Building MCP Servers](https://docs.anthropic.com/mcp/)

---

## 版本历史

### v1.0.0 (Phase 1 - 已完成)

- ✅ 本地文档索引（TXT, MD, PDF, DOCX, PPTX）
- ✅ SQLite + FTS5 全文搜索
- ✅ MCP 协议接口
- ✅ Cherry Studio 集成
- ✅ 日志文件隔离

### v2.0.0 (Phase 2 - 计划中)

- 🚧 飞书 OAuth 授权
- 🚧 飞书文档同步
- 🚧 增量更新
- 🚧 自动同步

### v3.0.0 (Phase 3 - 规划中)

- 📋 企业微信集成
- 📋 或手动导出方案

### v4.0.0 (Phase 4 - 可选)

- 📋 向量搜索
- 📋 语义检索
- 📋 混合搜索策略

---

## 许可证

MIT License

---

**文档最后更新**: 2025-11-11
**项目状态**: Phase 1 完成，Phase 2 设计中
