# Personal Knowledge MCP Server

个人知识库 MCP 服务器 — 对本地文档建立索引，并提供一组飞书 API 工具，通过 MCP 协议供 AI 客户端访问。

支持 BM25 关键词搜索 + 向量语义搜索的混合检索（Hybrid Search），基于 RRF 融合排名，全部运行在单个 SQLite 文件中，零外部依赖。

> 当前项目现状、能力边界和使用建议，以 [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) 为准。
>
> 当前代码里，`search_documents` 主要搜索本地已索引文件；飞书内容当前主要通过独立 MCP 工具按需读取/写入，并不会自动统一同步进本地 SQLite 索引。

## 功能特性

- 本地文档索引（TXT, MD, PDF, DOCX, PPTX）
- 中文分词优化（jieba）
- 文档智能分块（按标题/段落切分）
- 混合搜索：FTS5 BM25 关键词检索 + sqlite-vec 向量 KNN 检索 + RRF 融合
- 本地 embedding 模型（all-MiniLM-L6-v2，384 维，零 API 调用）
- 增量索引（基于文件 mtime，跳过未变更文件）
- 死文档自动清理
- 搜索结果返回查询词定位 snippet（自动居中到匹配位置）
- 同一文档返回多个命中片段（最多 3 个 chunk）
- 标题匹配 10x 加权
- 飞书集成：云文档、多维表格、电子表格、知识库读写工具
- Work Wiki 基础设施：`index_file` 增量索引 + 本地搜索 + 飞书工具
- MCP 协议标准接口

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置

编辑 `config.json`：

```json
{
  "local": {
    "enabled": true,
    "watch_paths": [
      "~/Documents",
      "~/Desktop"
    ],
    "file_extensions": [".txt", ".md", ".pdf", ".docx", ".pptx"],
    "exclude_patterns": ["**/node_modules/**", "**/.git/**"]
  },
  "feishu": {
    "enabled": false,
    "app_id": "",
    "app_secret": ""
  },
  "database": {
    "path": "./data/knowledge.db"
  }
}
```

### 3. 构建

```bash
npm run build
```

### 4. 索引文档

```bash
npm run index
```

增量模式：只处理新增/修改的文件，自动清理已删除文件的索引，自动为新增/变更文档生成 embedding 向量。

### 5. 补跑向量索引（可选）

```bash
npm run embed
```

仅用于为历史存量文档补生成 embedding。日常使用无需手动调用，`npm run index` 和 `sync_local_documents` 已自动生成。

首次运行会自动下载 embedding 模型（~80MB），后续运行使用缓存。

### 6. 启动 MCP Server

```bash
npm start
```

### 7. 配置 AI 客户端

在 Cherry Studio / Cursor / 其他 MCP 客户端中添加：

```json
{
  "personal-knowledge": {
    "command": "node",
    "args": ["/absolute/path/to/personal-knowledge-mcp/dist/index.js"],
    "cwd": "/absolute/path/to/personal-knowledge-mcp"
  }
}
```

如果你希望快速了解当前代码现实，而不是只看产品概述，建议先读：

```text
PROJECT_STATUS.md
```

## 命令参考

| 命令 | 说明 |
|------|------|
| `npm run build` | 编译 TypeScript |
| `npm run dev` | 开发模式（watch 编译） |
| `npm run index` | 索引本地文档（增量） |
| `npm run embed` | 生成文档 embedding 向量 |
| `npm start` | 启动 MCP Server |
| `npm run sync` | 预留脚本，当前未实现完整“同步所有文档源”流程 |

## 搜索架构

```
查询 → jieba 分词 → FTS5 BM25 搜索 ─┐
                                       ├→ RRF 融合排名 → 每文档最多3片段 → Top-K
查询 → embedding 模型 → sqlite-vec KNN ┘
```

- 关键词搜索擅长精确匹配（函数名、错误码、专有名词）
- 向量搜索擅长语义匹配（"怎么处理超时" 匹配 "timeout handling"）
- RRF (Reciprocal Rank Fusion) 融合两者排名，无需训练数据
- 同一文档最多返回 3 个不同片段，避免遗漏长文档中的多处命中
- Snippet 自动定位到查询词出现位置，而非固定截取开头

## MCP 工具列表

### 知识库工具

| 工具 | 说明 |
|------|------|
| `search_documents` | 搜索文档（支持混合检索） |
| `get_document` | 获取完整文档内容 |
| `list_documents` | 列出文档（按更新时间排序） |
| `get_stats` | 获取统计信息 |
| `sync_local_documents` | 手动触发本地文档同步 |
| `index_file` | 索引单个本地文件（适合新写入文件的秒级可搜） |

### 飞书工具（需在 config.json 中启用）

以下工具是“直连飞书 Open API”的工具层，不等于“飞书内容已进入本地搜索索引”。

| 工具 | 说明 |
|------|------|
| `get_bitable_records` | 获取多维表格记录（支持筛选、排序） |
| `list_bitable_tables` | 列出多维表格中的数据表 |
| `create_bitable_records` | 创建多维表格记录（批量） |
| `update_bitable_record` | 更新单条多维表格记录 |
| `batch_update_bitable_records` | 批量更新多维表格记录 |
| `delete_bitable_records` | 删除多维表格记录（批量） |
| `list_wiki_spaces` | 列出可访问的知识空间列表 |
| `get_wiki_nodes` | 获取知识空间节点列表（支持递归） |
| `get_wiki_node_content` | 获取知识库文档内容（只需 node_token） |
| `get_docx_content` | 获取云文档纯文本内容 |
| `list_drive_files` | 列出云盘文件夹中的文件 |
| `get_drive_file_content` | 获取云盘文件内容 |
| `get_sheet_data` | 获取电子表格数据 |
| `list_sheets` | 列出电子表格工作表 |
| `write_sheet_data` | 写入电子表格数据 |
| `append_sheet_data` | 追加电子表格数据 |
| `list_bitable_fields` | 列出多维表格字段定义 |
| `create_bitable_field` | 创建多维表格字段 |
| `update_bitable_field` | 更新多维表格字段 |
| `delete_bitable_field` | 删除多维表格字段 |

## 项目结构

```
personal-knowledge-mcp/
├── src/
│   ├── index.ts                # 入口（动态 import，解决 onnxruntime 线程问题）
│   ├── server.ts               # MCP Server 实现
│   ├── types.ts                # TypeScript 类型定义
│   ├── storage/
│   │   └── database.ts         # SQLite + FTS5 + sqlite-vec 数据库
│   ├── crawlers/
│   │   └── local-crawler.ts    # 本地文档爬虫（增量索引）
│   ├── feishu/                 # 飞书 API 集成
│   │   ├── client.ts           # 飞书客户端
│   │   ├── bitable.ts          # 多维表格
│   │   ├── sheets.ts           # 电子表格
│   │   ├── wiki.ts             # 知识库
│   │   ├── docx.ts             # 云文档
│   │   └── drive.ts            # 云盘
│   └── utils/
│       ├── file-parser.ts      # 文件解析（PDF/DOCX/PPTX）
│       ├── tokenizer.ts        # 中文分词（jieba）
│       ├── chunker.ts          # 文档分块
│       └── embedder.ts         # 本地 embedding 模型（批量推理）
├── data/
│   └── knowledge.db            # SQLite 数据库（自动生成）
├── config.json                 # 配置文件
└── package.json
```

## 数据库 Schema

```
documents          主文档表（id, source, title, content, metadata）
chunks             文档分块表（doc_id, chunk_index, content, tokenized_content）
chunks_fts         FTS5 全文索引（基于分块，中文分词后存储）
chunks_vec         sqlite-vec 向量索引（384 维 float embedding）
```

## 已知问题

Node.js v24 + onnxruntime-node 存在线程 mutex 兼容性问题，进程退出时可能出现 `mutex lock failed` 错误。不影响功能，embedding 生成和搜索均正常工作。`index.ts` 已通过动态 import 和 `OMP_NUM_THREADS=1` 环境变量缓解此问题。

另外需要注意：

- 当前没有 `feishu-crawler`，也没有“飞书全文自动同步入本地库”的实现
- `npm run sync` 目前是预留脚本，不应当作可用的全量同步入口
- `LocalCrawler.startWatching()` 已实现，但默认启动路径没有启用文件监听；当前仍以手动 `npm run index` 为主

## 常见问题

**索引速度慢？** 减少 `watch_paths` 范围，用 `exclude_patterns` 排除大目录。增量索引只处理变更文件。

**Embedding 生成慢？** `npm run embed` 使用批量推理（每批 50 条），比逐条处理快数倍。首次运行需下载模型（~80MB），后续使用缓存。

**搜索不到文档？** 确认已运行 `npm run index`，检查 `file_extensions` 是否包含目标文件类型。

**如何更新索引？** 重新运行 `npm run index`，增量处理变更文件并自动清理已删除文件，同时自动为新增/变更文档生成 embedding 向量。

**飞书内容会自动进入 `search_documents` 吗？** 当前不会。飞书内容主要通过独立 MCP 工具按需读取。如果希望进入本地搜索，建议导出为本地文件，或按 Work Wiki 流程写入 `raw/` / `wiki/` 后再用 `index_file` 或 `npm run index` 建索引。

**Cherry Studio 连接失败？** 确认已运行 `npm run build`，配置中使用绝对路径。

## 许可证

MIT
