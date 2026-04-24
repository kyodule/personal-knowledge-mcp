# Project Status

> 最后更新：2026-04-10
> 适用对象：项目维护者、后续参与开发的 agent、需要快速了解项目现状的人

## 1. 这是什么项目

`personal-knowledge-mcp` 是一个基于 TypeScript 的本地 MCP Server。

它当前的实际定位是：

- 一个可在本机运行的个人知识库 MCP 服务
- 核心能力是对本地文档建立 SQLite 索引，并通过 MCP 工具提供搜索和读取
- 同时提供一组飞书 API 工具，用于直接读取和操作飞书知识库、云文档、云盘、电子表格、多维表格
- 还承担了 Work Wiki 工作流中的基础设施角色：本地搜索、飞书读写、`index_file` 增量索引

需要特别注意的一点：

- 当前代码里，**真正进入 SQLite 本地索引并参与 `search_documents` 的，主要是本地文件**
- 飞书能力当前主要是 **按需调用飞书 API 的工具层**
- 项目里一些旧文档把它描述成“本地文档 + 飞书文档统一索引”，这更接近历史目标或文档表述，不完全等于当前代码现实

## 2. 当前能力现状

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 本地文档索引 | 已实现 | 支持 `.txt` / `.md` / `.pdf` / `.docx` / `.pptx` |
| 本地增量索引 | 已实现 | 基于文件 `mtime` 跳过未变更文件，并清理已删除文件 |
| 单文件增量索引 | 已实现 | 通过 MCP 工具 `index_file` 立即索引单个文件 |
| 文档分块 | 已实现 | 按 Markdown 标题、空行、长段落拆分 chunk |
| 中文搜索优化 | 已实现 | 文档和查询都使用 `jieba.cutForSearch` |
| 混合搜索 | 已实现 | BM25 + sqlite-vec KNN + RRF 融合 |
| snippet 定位 | 已实现 | 搜索结果尽量围绕命中词生成片段 |
| 每文档多片段返回 | 已实现 | 同一文档最多返回 3 个 chunk |
| embedding 自动生成 | 已实现 | `npm run index` 时自动为新增/修改 chunk 生成向量 |
| 飞书知识空间读取 | 已实现 | `list_wiki_spaces`、`get_wiki_nodes`、`get_wiki_node_content` |
| 飞书云文档读取 | 已实现 | `get_docx_content` |
| 飞书云盘读取 | 已实现 | `list_drive_files`、`get_drive_file_content` |
| 飞书电子表格读取 | 已实现 | `list_sheets`、`get_sheet_data`，并支持从 wiki 节点识别 sheet |
| 飞书电子表格写入 | 已实现 | `write_sheet_data`、`append_sheet_data` |
| 飞书多维表格读写 | 已实现 | 记录 CRUD + 字段 CRUD |
| 飞书统一同步入本地索引 | 未实现 | 没有 `feishu-crawler`，也没有把飞书内容批量写入 SQLite 的当前实现 |
| 企业微信接入 | 未实现 | 配置和类型占位存在，但没有实际 crawler / tool |
| 自动文件监听 | 代码存在但未接入运行流程 | `LocalCrawler.startWatching()` 已实现，但当前启动路径没有调用它 |
| Work Wiki 业务工作流 | 部分在仓库内，部分在仓库外 | 仓库提供基础设施；编译/收录规则主要在外部 vault 的 `AGENTS.md` 中 |

## 3. 当前实现边界

### 3.1 本地索引与搜索

当前真正稳定落地的主线是：

1. 扫描 `config.json` 中的 `watch_paths`
2. 解析文件内容
3. 写入 `documents`
4. 对文档切 chunk，写入 `chunks`
5. 对 chunk 建立 `chunks_fts`
6. 为 chunk 生成 embedding，写入 `chunks_vec`
7. `search_documents` 查询时执行 BM25 + 向量召回 + RRF 融合

### 3.2 飞书能力的真实形态

当前飞书部分更准确的描述是：

- MCP Server 内置了飞书客户端
- 暴露了 20 个飞书工具
- 这些工具大多是“调用飞书 Open API -> 返回结果”
- 它们不是“后台自动同步飞书内容到本地库再统一搜索”

这意味着：

- 你可以通过 MCP 直接读飞书资源
- 但 `search_documents` 目前不等于“全量搜索飞书”
- 如果想让飞书内容进入本地混合搜索，当前更可行的方式是导出到本地文件，或走 Work Wiki 的收录/编译流程

### 3.3 Work Wiki 的真实形态

当前 Work Wiki 是“仓库内能力 + 仓库外规则”的组合：

- 本仓库提供：
  - 本地索引
  - `index_file`
  - 飞书工具
  - 本地搜索
- 外部 Obsidian vault `~/Documents/myob/` 提供：
  - `raw/`
  - `wiki/`
  - 具体收录/编译/查询规则
  - 知识库收集箱配置

换句话说：

- `personal-knowledge-mcp` 不是完整的 Work Wiki 产品本体
- 它是 Work Wiki 的 MCP 基础设施层

## 4. MCP 工具现状

当前代码中，MCP 工具分为两大类：

### 4.1 核心/本地工具（9 个）

- `search_documents`（支持 BM25 + 向量 + RRF 混合召回；可选 `rerank: true` 启用 cross-encoder 重排）
- `get_document`
- `list_documents`
- `get_stats`
- `sync_local_documents`
- `index_file`
- `lint_duplicates` —— 文档级 embedding 近似重复检测，输出 merge/review 候选对
- `find_similar_pages` —— Ingest 去重决策，返回 merge/review/distinct 建议
- （内部）reranker / similar / lint 等 retrieval 模块由 `src/retrieval/` 提供

### 4.2 飞书工具（20 个，需 `feishu.enabled=true`）

Wiki / Docx / Drive / Sheet：

- `list_wiki_spaces`
- `get_wiki_nodes`
- `get_wiki_node_content`
- `get_docx_content`
- `list_drive_files`
- `get_drive_file_content`
- `get_sheet_data`
- `list_sheets`
- `write_sheet_data`
- `append_sheet_data`

Bitable：

- `get_bitable_records`
- `list_bitable_tables`
- `create_bitable_records`
- `update_bitable_record`
- `batch_update_bitable_records`
- `delete_bitable_records`
- `list_bitable_fields`
- `create_bitable_field`
- `update_bitable_field`
- `delete_bitable_field`

总结：

- 飞书关闭时：总共 8 个工具
- 飞书开启时：总共 28 个工具

完整参数说明建议看 `docs/use.md`。

## 5. 技术实现现状

### 5.1 运行方式

- 运行协议：MCP stdio
- 入口文件：`src/index.ts`
- 服务实现：`src/server.ts`
- 构建产物：`dist/index.js`

当前没有 HTTP 服务层，也没有单独的 Web UI。它是一个典型的本地 stdio MCP Server。

### 5.2 核心技术栈

- TypeScript
- `@modelcontextprotocol/sdk`
- `better-sqlite3`
- `sqlite-vec`
- `@node-rs/jieba`
- `@huggingface/transformers`
- `onnxruntime-node`
- `@larksuiteoapi/node-sdk`

### 5.3 本地文件解析

当前解析器位于 `src/utils/file-parser.ts`，支持：

- `.txt` / `.md`：直接读取文本
- `.pdf`：`pdf-parse`
- `.docx`：`mammoth.extractRawText`
- `.pptx`：解压 ZIP 后读取 `ppt/slides/slide*.xml`

### 5.4 数据库存储

当前 SQLite 里主要有 4 张核心表/虚表：

- `documents`
- `chunks`
- `chunks_fts`
- `chunks_vec`

实际意义：

- `documents` 存原文档
- `chunks` 存切分结果
- `chunks_fts` 支持 BM25/FTS5 搜索
- `chunks_vec` 支持向量相似度检索

### 5.5 搜索实现

当前 `search_documents` 的行为是：

- 先对 query 分词
- 尝试生成 query embedding
- 如果 embedding 成功，则做混合搜索
- 如果 embedding 不可用，则回退到 BM25-only
- 用 RRF 融合 BM25 和向量召回结果
- 同一文档最多返回 3 个片段

### 5.6 飞书接入方式

当前飞书客户端：

- 使用 `tenant_access_token` 模式
- 通过 `src/feishu/client.ts` 单例初始化
- 在 `src/server.ts` 中统一经 `withFeishuRetry()` 包装

已知实现特征：

- 对知识空间、云盘、多维表格、字段列表等读取做了分页处理
- `docx` 提取已经支持分页和常见 block 类型
- `sheet` 读写使用 API 调用封装，而不是完全依赖 SDK 高层方法

## 6. 当前本地配置快照

以下描述的是这台机器当前工作区的本地状态，不代表开源默认配置：

- `config.json` 当前启用了本地索引
- `watch_paths` 当前包含：
  - 仓库内 `test-docs`
  - `~/Documents`
  - `~/Desktop`
- `config.json` 当前启用了飞书
- 数据库路径当前为 `./data/knowledge.db`
- 仓库同时提供了 `config.example.json` 作为脱敏模板

重要提醒：

- `config.json` 是本地私密配置，当前包含真实凭证
- 不应提交或外发
- 对外共享配置时应使用 `config.example.json`

## 7. 如何使用

### 7.1 首次启动

1. 安装依赖

```bash
npm install
```

2. 检查并编辑本地配置

```bash
vim config.json
```

3. 构建

```bash
npm run build
```

4. 建立本地索引

```bash
npm run index
```

5. 启动 MCP Server

```bash
npm start
```

### 7.2 最常用命令

```bash
npm run build
npm run index
npm run embed
npm start
```

说明：

- `npm run index`：当前最重要的索引入口，会做本地文档增量索引并自动补 embedding
- `npm run embed`：给已有 chunk 补跑 embedding
- `npm start`：启动 MCP Server
- `npm run sync`：**目前仍是占位脚本**。`package.json` 里有脚本，但 `src/index.ts` 没有真正实现 `--sync` 分支，不应把它当成可用的“同步所有文档源”入口

### 7.3 日常使用建议

日常本地文档流程：

1. 修改或新增本地文件
2. 运行 `npm run index`
3. 在客户端里使用 `search_documents`

如果是单个文件刚写入、希望立即可搜：

- 直接调用 MCP 工具 `index_file`

### 7.4 Cherry Studio / 其他 MCP 客户端

客户端指向：

- command: `node`
- args: `["/absolute/path/to/personal-knowledge-mcp/dist/index.js"]`
- cwd: 项目根目录

首次接通后，建议先验证：

1. `get_stats`
2. `list_documents`
3. `search_documents`

如果飞书已启用，再验证：

1. `list_wiki_spaces`
2. `get_docx_content`
3. `get_sheet_data`
4. `get_bitable_records`

### 7.5 Work Wiki / 知识库收录的特殊规则

这是后续 agent 最容易做错的地方。

当用户要求“把某个链接收录到知识库 / 存进知识库 / 索引到知识库”时，不应只把内容放进本仓库的 `test-docs/`，而应遵循外部 vault 工作流。

必须记住：

- 真实保存位置应在 `~/Documents/myob/raw/`
- 需要登记飞书多维表格“知识库收集箱”
- 需要执行 Ingest 编译流程
- 对新建或更新文件调用 `index_file`

具体规则以：

- `~/Documents/myob/AGENTS.md`

为最高优先级工作流说明。

简化理解：

- 本仓库提供工具
- 外部 myob vault 提供知识库业务规则

## 8. 当前文档地图

### 8.1 当前有效，优先阅读

- `PROJECT_STATUS.md`
  - 当前事实总览
- `README.md`
  - 产品概述和基础说明
- `QUICKSTART.md`
  - 快速启动
- `docs/use.md`
  - 飞书工具参数手册
- `docs/work-wiki-guide.md`
  - Work Wiki 使用手册
- `docs/specs/2026-04-08-work-wiki-design.md`
  - Work Wiki 设计和本次能力边界

### 8.2 有参考价值，但属于历史材料

- `plan.md`
  - 早期阶段性规划，很多“Phase 2/3/4”描述已经过时
- `mcp.txt`
  - 早期开发会话长记录
- `2025-12-29-personal-knowledge-mcp-server.md`
  - 飞书扩展阶段说明，部分内容已被后续实现吸收
- `docs/conversations/`
  - 迭代过程记录，适合追溯改动背景

### 8.3 更像样例/内容素材，不是项目实现文档

- `test-docs/`
- `test-pptx.md`
- `AI产研团队培训文档.md`

这些文件更适合视为索引样例、测试材料或知识内容，不应当作项目设计规范的主要来源。

## 9. 已知问题与工程现实

### 9.1 当前仍需注意的问题

- Node.js v24 + `onnxruntime-node` 仍有 mutex 兼容性问题，入口已经通过动态 import 和 `OMP_NUM_THREADS=1` 做缓解
- 当前没有自动化测试体系，验证主要靠 `npm run build`、`npm run index` 和 MCP 手工调用
- `server.ts` 仍然偏大，工具定义和 handler 高度集中
- 本地 `config.json` 含真实凭证，必须视为秘密
- 一些旧文档仍把飞书描述成“已统一索引进本地库”，实际代码并非如此
- 自动 watcher 代码存在，但当前启动路径没有开启它，实际运行模式仍是“手动 re-index”
- `npm run sync` 当前不可视为可用功能

### 9.2 当前最重要的代码现实

未来做迭代时，最容易踩坑的不是“功能没有”，而是“文档写了，但代码现状没完全跟上”。当前应优先以以下顺序判断事实：

1. `src/` 源码
2. `config.json` / `config.example.json`
3. `PROJECT_STATUS.md`
4. `README.md` / `docs/use.md` / `docs/work-wiki-guide.md`
5. 其余历史文档

## 10. 建议的开发与维护方式

### 10.1 后续 agent 进入项目时的阅读顺序

建议先读：

1. `PROJECT_STATUS.md`
2. `README.md`
3. `docs/use.md`
4. `docs/work-wiki-guide.md`
5. 相关源码文件

如果任务涉及 Work Wiki 收录，再额外读：

6. `~/Documents/myob/AGENTS.md`

### 10.2 做功能迭代时，哪些文档需要一起更新

如果变更了以下内容，应同步更新：

- 用户可见能力边界：更新 `PROJECT_STATUS.md` 和 `README.md`
- 启动或命令行为：更新 `PROJECT_STATUS.md` 和 `QUICKSTART.md`
- 飞书工具参数或新增工具：更新 `PROJECT_STATUS.md` 和 `docs/use.md`
- Work Wiki 工作流：更新 `PROJECT_STATUS.md`、`docs/work-wiki-guide.md`、相关 spec

### 10.3 当前建议的验证基线

至少执行：

```bash
npm run build
```

涉及索引或搜索时，再执行：

```bash
npm run index
```

涉及飞书工具时，再在 MCP 客户端中做最小验证：

- 一个读取类调用
- 一个列表类调用
- 如果涉及写操作，再做一次真实写入验证

## 11. 一句话结论

当前这个仓库已经是一个可用的“本地知识库 MCP + 飞书操作工具层 + Work Wiki 基础设施”，但它还不是一个已经把飞书/企微完整统一同步进本地索引的终态系统。

后续开发、调试和 agent 协作时，应优先把它当成：

- 本地索引与混合搜索引擎
- 飞书 API 工具集
- Work Wiki 的 MCP 基础设施层

而不是“所有外部知识源都已自动统一入库”的完成态产品。
