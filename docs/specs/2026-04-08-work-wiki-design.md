# Work Wiki — 基于 LLM Wiki 模式的工作知识库

**日期**: 2026-04-08
**状态**: Implemented (v1)
**灵感来源**: Karpathy LLM Wiki (gist, 2026-04-04)

## 1. 背景与目标

### 问题

当前知识散落在多个系统中——飞书文档、飞书知识库、企微、本地 Obsidian/Logseq、各种聊天群里的零散链接。使用 AI Agent 时，用户的大脑被迫充当"路由器"，需要手动告诉 agent 去哪里调取什么文档。

已有的 personal-knowledge-mcp 虽然提供了本地文档索引和飞书 API 集成，但只是原始文档的检索层，缺乏一个"编译过的知识层"——即 LLM 已经做好摘要、建好交叉引用、标注过矛盾的结构化知识库。

### 目标

在现有 Obsidian vault 和 MCP 基础上，以最低成本搭建一个 Karpathy 式的 LLM Wiki：

1. **统一入口**：所有知识操作都通过给 Droid 下指令完成
2. **自动编译**：LLM 把零散原始资料编译成结构化、互相链接的 Markdown Wiki
3. **知识复利**：每次查询和探索都能沉淀为新的知识页面
4. **最小代码改造**：MCP 侧仅新增 `index_file` 增量索引工具和 tokenizer 修复，其余通过 AGENTS.md Schema 实现

### 非目标

- 不做全自动采集（收集是人的决策）
- 不接入企微（后续可扩展）
- 不构建 RAG 管线（当前规模下 index.md + MCP 搜索足够）

## 2. 架构概览

```
用户下指令
    ↓
Droid（LLM 编译器，遵循 AGENTS.md 规则）
    ↓ 调用
MCP 工具层
    ├── 飞书 API：读文档、操作多维表格
    ├── 本地索引：搜索 wiki/ 和 raw/ 下的文件
    ├── index_file：单文件增量索引（🆕 本次新增）
    └── content-extract skill：抓取外部网页
    ↓
Obsidian vault（~/Documents/myob/）
    ├── raw/     → 原始资料（不可变）
    ├── wiki/    → LLM 编译的知识库
    └── AGENTS.md → Schema 配置
```

**关键设计决策**：编译逻辑在 Droid 侧（AGENTS.md），不在 MCP 侧。MCP 只负责数据存取，Droid 是知识编译器。

## 3. 目录结构

在现有 Obsidian vault `~/Documents/myob/` 中新增：

```
~/Documents/myob/
├── journals/          # (已有) logseq 日记，不动
├── pages/             # (已有) logseq 知识页面，不动
├── personal/          # (已有) 不动
├── work/              # (已有) 不动
├── raw/               # 🆕 原始资料（Droid 只读不改）
│   ├── feishu/        #    飞书导出的文档
│   ├── articles/      #    网页文章
│   └── misc/          #    其他零散资料
├── wiki/              # 🆕 Droid 编译维护的知识库
│   ├── index.md       #    总目录（按分类组织）
│   ├── log.md         #    操作日志（append-only 时间线）
│   ├── entities/      #    实体页面（项目、人、团队）
│   ├── concepts/      #    概念页面（技术方案、流程、架构）
│   ├── sources/       #    每篇源文档的摘要页
│   └── synthesis/     #    综合分析、对比、洞察
└── AGENTS.md          # 🆕 Schema 配置文件
```

**约束**：
- `raw/` 一旦写入即不可变，Droid 只读
- `wiki/` 完全由 Droid 维护，用户只浏览
- 已有目录（journals/, pages/, work/, personal/）不受影响
- MCP 已索引 `~/Documents`，新增目录自动进入搜索范围

## 4. 飞书收集箱（多维表格）

创建一个飞书多维表格，作为知识来源的完整登记册。由 Droid 全权维护。

### 字段设计

| 字段 | 类型 | 说明 |
|------|------|------|
| 标题 | 文本 | 文档标题 |
| 链接 | URL | 原始链接 |
| 来源 | 单选 | 飞书文档 / 飞书知识库 / 网页文章 / 其他 |
| 收录日期 | 日期 | 自动填入当天 |
| 状态 | 单选 | 已收录 / 已编译 / 编译失败 |
| 本地路径 | 文本 | raw/ 下的相对文件路径 |
| 摘要 | 文本 | LLM 编译后回填的一句话摘要 |

### 用途

- 用户在飞书手机端可随时查看知识库的完整收录目录
- Droid 通过 MCP 的 bitable 工具读写此表
- 状态字段用于追踪采集→编译的完整流程

## 5. 工作流

### 5.1 收录（Collect）

**触发**：用户给 Orchids 一个链接 + 指令

**流程**：
1. **判断来源**：飞书链接 → 调 MCP 飞书工具；微信公众号链接 → 用 `wechat-article-to-markdown`；其他外部链接 → 调 content-extract skill
2. **保存 raw 文件**：写入 `raw/{来源类型}/{YYYY-MM-DD}-{标题slug}.md`（或含 `images/` 的目录），文件顶部注明原始链接、采集日期、来源
3. **登记多维表格**：调 MCP `create_bitable_records`，状态=已收录
4. **增量索引**：调 MCP `index_file` 索引新写入的 raw 文件，确保立即可被搜索到
5. **执行 Ingest**：立即进入编译流程

支持单篇和批量：
- 单篇：`"把这个存进知识库：{链接}"`
- 批量：`"把飞书知识空间 xxx 的文档都收录进来"`（遍历 `get_wiki_nodes` → 逐个处理）

### 5.2 编译（Ingest）

**触发**：收录完成后自动执行，或用户手动指定 raw 文件

**流程**：
1. 读取 raw 文件全文
2. 在 `wiki/sources/` 创建摘要页：
   - YAML frontmatter（type: source, title, created, source_url, tags）
   - 300-500 字摘要
   - 关键要点列表
   - 原文出处链接
3. 提取 3-8 个核心概念：
   - 已有 `wiki/concepts/{概念}.md` → 更新页面，补充新信息，加反向链接
   - 不存在 → 新建概念页
4. 提取实体（项目名、人名、团队等）：
   - 同理更新 `wiki/entities/`
5. 所有页面使用 `[[双链]]` 语法互相引用
6. 更新 `wiki/index.md`：对应分类下新增条目
7. 追加 `wiki/log.md`：`## [YYYY-MM-DD] ingest | {标题}`，含摘要 + 影响页面列表
8. 回填飞书多维表格：状态→已编译，填入摘要
9. **增量索引**：对所有新建/更新的 wiki 页面调用 `index_file`，确保可被搜索到

### 5.3 查询（Query）

**触发**：用户提问

**流程**：
1. 调 MCP `search_documents` 搜索 wiki/ 下相关页面
2. 读取匹配的 wiki 页面获取上下文
3. 如需更多细节 → 读取 `wiki/sources/` 摘要页
4. 如仍需原始信息 → 读取 `raw/` 源文件
5. 综合回答，标注信息出处
6. 如果回答产生有价值的新综合分析 → 提议存入 `wiki/synthesis/`

**典型场景**：
- `"根据本周收录的项目文档，总结一份本周项目进展"` → Droid 读 log.md 找本周记录 → 读相关页面 → 输出总结
- `"安全风控的整体架构是怎样的？"` → Droid 搜索 wiki → 读概念页和实体页 → 综合回答

### 5.4 健康检查（Lint）

**触发**：用户手动要求（建议每周一次）

**检查项**：
- 孤立页面（无 `[[入链]]`）
- 被提及但无专属页面的概念
- 不同页面间的事实矛盾
- 超过 30 天未更新的页面
- index.md 中缺失的条目
- 多维表格与 raw/ 目录的一致性

**输出**：报告 + 建议操作，用户确认后执行修复。

## 6. Wiki 页面格式约定

所有 `wiki/` 下的 .md 文件必须遵循：

```yaml
---
type: concept | entity | source | synthesis
title: 页面标题
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources: [相关原始文档标题]
tags: [标签1, 标签2]
---
```

- 使用 Obsidian `[[双链]]` 语法建立页面间引用
- 标题用 `#` 一级标题
- 末尾统一加 `## 相关页面` 小节
- 中文内容为主，技术术语保留英文
- frontmatter 支持 Obsidian Dataview 插件动态查询

## 7. AGENTS.md Schema

完整内容见实施阶段输出。核心内容：
- 身份定义（知识库全职维护者）
- 目录结构说明
- 飞书收集箱配置（app_token, table_id）
- 四个工作流的详细规则（Collect / Ingest / Query / Lint）
- 页面格式约定
- 禁止事项（不改 raw/，不动已有目录）

## 8. 依赖的工具

| 工具 | 来源 | 用途 |
|------|------|------|
| `get_wiki_node_content` | personal-knowledge-mcp | 读飞书知识库文档 |
| `get_docx_content` | personal-knowledge-mcp | 读飞书云文档 |
| `get_bitable_records` | personal-knowledge-mcp | 读多维表格 |
| `create_bitable_records` | personal-knowledge-mcp | 写多维表格 |
| `update_bitable_record` | personal-knowledge-mcp | 更新多维表格 |
| `get_wiki_nodes` | personal-knowledge-mcp | 列知识空间文档 |
| `get_sheet_data` | personal-knowledge-mcp | 读电子表格 |
| `search_documents` | personal-knowledge-mcp | 搜索本地知识库（BM25 + 向量混合搜索） |
| `index_file` | personal-knowledge-mcp (🆕) | 单文件增量索引，写入文件后立即调用，确保可被搜索 |
| `sync_local_documents` | personal-knowledge-mcp | 全量重新索引（仅在需要重建全部索引时使用） |
| `wechat-article-to-markdown` | CLI 工具 (pipx) | 微信公众号文章抓取（Camoufox 反爬 + 图片本地化） |
| content-extract skill | Droid skill | 抓取外部网页内容 |
| Create 工具 | Droid 内置 | 创建本地文件 |
| Read 工具 | Droid 内置 | 读取本地文件 |

## 9. 实施步骤

| 步骤 | 具体动作 | 工作量 |
|------|---------|--------|
| 1 | 在 `~/Documents/myob/` 下创建 `raw/`（含子目录）、`wiki/`（含子目录）目录结构 | 5 分钟 |
| 2 | 创建 `AGENTS.md` Schema 文件 | 10 分钟 |
| 3 | 初始化 `wiki/index.md`（空分类框架）和 `wiki/log.md` | 2 分钟 |
| 4 | 在飞书创建收集箱多维表格，Droid 应用授权管理权限 | 10 分钟 |
| 5 | 将多维表格的 app_token 和 table_id 填入 AGENTS.md | 1 分钟 |
| 6 | 触发 MCP 重新索引（`sync_local_documents`），确认 wiki/ 和 raw/ 被收录 | 2 分钟 |
| 7 | 验证：给 Orchids 一个飞书链接，走完收录→编译→查询全流程 | 验证 |

**总计**：约 30 分钟可完成搭建并验证。

## 10. 实施过程中的 MCP 改进（2026-04-08）

在搭建 Work Wiki 并进行首次测试时，发现了两个影响搜索可用性的问题，已修复并合入主分支：

### 10.1 新增 `index_file` 增量索引工具

**问题**：MCP 的文档索引依赖 `sync_local_documents` 全量扫描，新写入 `raw/` 或 `wiki/` 的文件在下次 sync 之前无法被搜索到。首次测试时，刚收录的飞书文档完全搜不到。

**方案**：在 MCP 侧新增 `index_file` 工具，接受单个文件路径，立即解析、分 chunk、写入 FTS5 索引并可选生成 embedding。Droid 在 Collect 和 Ingest 流程中写入文件后立即调用此工具，实现秒级可搜索。

**改动文件**：
- `src/crawlers/local-crawler.ts` — 新增 `indexFile()` 公开方法
- `src/storage/database.ts` — 新增 `getChunkDocId()` 和 `getDocumentChunkCount()` 辅助方法
- `src/server.ts` — 注册 `index_file` 工具定义和 handler

### 10.2 修复 tokenizer 文档/查询不对称问题

**问题**：文档侧使用 `jieba.cut`（粗粒度分词），查询侧使用 `jieba.cutForSearch`（细粒度分词）。例如"九宫格"在文档中被保留为一个完整 token，但查询时被拆为"九宫 宫格 九宫格"三个 token。FTS5 MATCH 默认 AND 逻辑要求所有 token 都匹配，导致"九宫"和"宫格"在文档索引中找不到，搜索失败。

**方案**：将文档侧分词也改为 `cutForSearch`，与查询侧保持一致。细粒度分词同时包含子词和完整词，提高召回率且不损失精确匹配能力。

**改动文件**：`src/utils/tokenizer.ts`

**注意**：此修复影响 FTS5 索引的分词结果。已索引的旧文档需要重新运行 `npm run index` 重建索引，否则部分包含复合词的旧文档可能存在搜索遗漏。

## 11. 后续扩展方向（不在本次范围）

- **企微接入**：通过企微会话存档 API 提取聊天中的文档链接
- **定时同步**：cron 定期调 Droid 处理飞书知识空间的增量更新
- **搜索增强**：当 wiki 规模超过 200 页时，考虑引入 qmd 等本地搜索引擎
- **微调**：用 wiki 内容生成训练数据，fine-tune 专属模型
