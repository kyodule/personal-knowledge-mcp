# Work Wiki — 个人工作知识库系统

**日期**: 2026-04-08
**架构**: Karpathy LLM Wiki 模式 + Obsidian + 飞书 + MCP

> 这是 Work Wiki 工作流手册，不是整个仓库的总状态页。
>
> 项目整体现状、能力边界和当前代码现实，以 [`PROJECT_STATUS.md`](../PROJECT_STATUS.md) 为准。

## 概述

Work Wiki 是一套基于 LLM 增量编译的个人工作知识库系统。用户负责决定收录什么，LLM（Droid/Orchids）负责采集、编译、整理和维护。所有知识操作通过自然语言指令完成，无需手动整理文档。

核心理念来自 Karpathy 的 LLM Wiki 模式（2026-04）：不做传统 RAG（每次从零检索），而是让 LLM **增量构建和维护一个持久化的结构化 Wiki**。

## 系统架构

```
用户（自然语言指令）
    ↓
Droid / Orchids（LLM 编译器，遵循 AGENTS.md 规则）
    ↓ 调用
┌──────────────────────────────────────────────────┐
│  工具层                                           │
│  ├── feishu-docx CLI        → 飞书文档高质量导出   │
│  ├── wechat-article-to-markdown                   │
│  │                          → 微信文章抓取(含图片) │
│  ├── personal-knowledge-mcp                       │
│  │   ├── 飞书 API           → 多维表格 CRUD        │
│  │   ├── 本地索引           → BM25+向量混合搜索     │
│  │   ├── index_file         → 单文件增量索引 🆕    │
│  │   ├── list_wiki_spaces   → 发现可用知识空间 🆕  │
│  │   └── 飞书知识库         → 递归遍历/内容获取     │
│  ├── content-extract        → 外部网页抓取          │
│  └── agent-browser          → 反爬兜底(手动验证)    │
└──────────────────────────────────────────────────┘
    ↓
Obsidian vault（~/Documents/myob/）
    ├── raw/     → 原始资料（不可变）
    ├── wiki/    → LLM 编译的知识库
    └── AGENTS.md → Schema 配置
```

## 目录结构

```
~/Documents/myob/
├── AGENTS.md              # Wiki 维护规则（Schema）
├── raw/                   # 原始资料，只读不改
│   ├── feishu/            #   飞书文档导出（Markdown + 图片资源）
│   ├── articles/          #   网页文章
│   └── misc/              #   其他
├── wiki/                  # LLM 编译维护的知识库
│   ├── index.md           #   总目录（按分类组织）
│   ├── log.md             #   操作日志（append-only）
│   ├── sources/           #   每篇源文档的摘要页
│   ├── concepts/          #   概念页面（技术方案、流程、架构）
│   ├── entities/          #   实体页面（项目、人、团队、产品）
│   └── synthesis/         #   综合分析、对比、洞察
├── journals/              # (已有) Logseq 日记，不动
├── pages/                 # (已有) Logseq 页面，不动
└── ...
```

## 工具分工

| 工具 | 职责 | 使用场景 |
|------|------|---------|
| **feishu-docx** (Python CLI) | 飞书文档导出为高质量 Markdown | 收录飞书文档时，保留标题、表格、加粗、图片等格式 |
| **wechat-article-to-markdown** (pipx) | 微信公众号文章抓取 | 收录微信文章，Camoufox 自动绕过反爬，图片本地化 |
| **personal-knowledge-mcp** | 多维表格 CRUD、知识空间发现与递归遍历、本地搜索、单文件增量索引 | 收集箱管理、wiki 检索、飞书结构浏览、`list_wiki_spaces` 发现空间、`get_wiki_nodes` 递归遍历、`index_file` 增量索引；注意当前飞书内容不是自动统一入本地搜索，只有落地到 `raw/` / `wiki/` 后才会进入本地索引 |
| **content-extract skill** | 外部网页内容抓取 | 收录非微信的外部网页文章 |
| **agent-browser** | 浏览器自动化 | 反爬兜底方案，遇到验证码时 `--headed` 模式手动过验证 |
| **Droid + AGENTS.md** | 知识编译引擎 | 摘要生成、概念提取、交叉链接、wiki 维护 |

### 为什么需要 feishu-docx？

MCP 的飞书文档读取是纯文本提取，会丢失所有格式（标题、表格、加粗、图片）。feishu-docx 输出高质量 Markdown，完整保留文档结构。实测对比：

- MCP 纯文本：~2KB，无格式，表格完全丢失
- feishu-docx：~7KB，完整 Markdown，5 个能力分级表格全部保留

feishu-docx 仅在**收录环节**使用，其余操作（搜索、多维表格、知识空间遍历）走 MCP。

## 飞书收集箱（多维表格）

作为知识来源的完整登记册，由 Droid 全权维护。

- **多维表格名称**: 知识库收集箱
- **app_token**: `T6AFbJb3pa6koDsWXL5cmLG4nrf`
- **table_id**: `tblSUepLLwix3k9F`

| 字段 | 类型 | 说明 |
|------|------|------|
| 标题 | 文本（主字段） | 文档标题 |
| 链接 | URL | 原始链接 |
| 来源 | 单选 | 飞书文档 / 飞书知识库 / 网页文章 / 其他 |
| 收录日期 | 日期 | 收录当天 |
| 状态 | 单选 | 已收录 / 已编译 / 编译失败 |
| 本地路径 | 文本 | raw/ 下的相对文件路径 |
| 摘要 | 文本 | LLM 编译后回填的一句话摘要 |

## 四大工作流

### 1. 收录（Collect）

用户给一个链接，Droid 根据来源类型自动选择最优采集方式：

**飞书文档**：
```
用户: "把这个存进知识库：https://beike.feishu.cn/wiki/xxx"

Droid 执行:
1. feishu-docx export "{链接}" -o ~/Documents/myob/raw/feishu/
2. 重命名为 {YYYY-MM-DD}-{标题}.md
3. 在飞书多维表格新增一行（状态=已收录）
4. 调用 index_file 索引新文件
5. 立即执行 Ingest
```

**微信公众号文章**：
```
用户: "把这篇文章收录进知识库：https://mp.weixin.qq.com/s/xxx"

Droid 执行:
1. cd ~/Documents/myob/raw/articles && wechat-article-to-markdown "{链接}"
2. 将 output/{标题}/ 移动到 raw/articles/{YYYY-MM-DD}-{标题slug}/
3. 在飞书多维表格新增一行（状态=已收录）
4. 调用 index_file 索引新文件
5. 立即执行 Ingest
```

**其他外部链接**：
```
用户: "把这个存进知识库：https://example.com/article"

Droid 执行:
1. content-extract skill 或 FetchUrl 抓取内容
2. 如被反爬拦截 → agent-browser --headed 打开，手动过验证后提取
3. 保存为 raw/articles/{YYYY-MM-DD}-{标题slug}.md
4. 在飞书多维表格新增一行（状态=已收录）
5. 调用 index_file 索引新文件
6. 立即执行 Ingest
```

### 2. 编译（Ingest）

将 raw 文档编译为结构化 wiki 页面：

```
1. 读取 raw 文件全文
2. 创建 wiki/sources/{日期}-{标题}.md（摘要页）
3. 提取 3-8 个核心概念 → 新建或更新 wiki/concepts/
4. 提取实体（项目、人、团队）→ 新建或更新 wiki/entities/
5. 所有页面用 [[双链]] 互相引用
6. 更新 wiki/index.md 和 wiki/log.md
7. 回填多维表格：状态→已编译，填入摘要
8. 对所有新建/更新的 wiki 页面调用 index_file 索引
```

### 3. 查询（Query）

用户提问，Droid 从 wiki 中检索并综合回答：

```
用户: "AI时代人才应该具备哪些核心能力？"

Droid 执行:
1. MCP search_documents 搜索 wiki/
2. 读取匹配的概念页和摘要页
3. 如需更多细节 → 读取 raw/ 源文件
4. 综合回答，标注出处（[[页面名]]）
5. 如产生有价值的分析 → 提议存入 wiki/synthesis/
```

### 4. 健康检查（Lint）

```
用户: "对知识库做一次健康检查"

检查项:
- 孤立页面（无入链）
- 被提及但无专属页面的概念
- 不同页面间的事实矛盾
- 超过 30 天未更新的页面
- index.md 缺失条目
- 多维表格与 raw/ 目录一致性
```

## 2026-04-08 知识库快照

以下内容是 2026-04-08 搭建 Work Wiki 当天的快照，用于说明当时的验证结果，不代表今天的实时状态。

### 已收录文档（5 篇）

| 标题 | 来源 | 状态 | 编译产出 |
|------|------|------|---------|
| AI时代人才能力模型 | 飞书知识库 | 已编译 | 1 source + 3 concepts |
| 深蓝项目-AI Native安全与红蓝对抗能力建设 | 飞书知识库 | 已编译 | 1 source + 4 concepts + 1 entity |
| 研发人才盘点方案（2026版） | 飞书知识库 | 已编译 | 1 source + 1 concept（+ 3 existing updated） |
| Karpathy LLM Wiki 知识库架构详解 | 微信公众号(InfoQ) | 已编译 | 1 source + 2 concepts (LLM Wiki, RAG) |
| 史上最强 Claude 发布 | 微信公众号(经纬创投) | 已收录 | 待编译 |

### Wiki 页面清单（15 页）

**Sources (4)**:
- 2026-04-08-AI时代人才能力模型
- 2026-04-08-深蓝项目-AI-Native安全与红蓝对抗能力建设
- 2026-04-08-研发人才盘点
- 2026-04-08-Karpathy-LLM-Wiki-InfoQ

**Concepts (10)**:
- 人机协同、AI人才培养、问题定义能力
- AI安全、红蓝对抗、AI安全防护网关、供应链安全
- 研发人才盘点
- LLM Wiki、RAG

**Entities (1)**:
- 深蓝项目

## 安装与配置

### 前置依赖

| 组件 | 安装方式 | 用途 |
|------|---------|------|
| personal-knowledge-mcp | 已有，MCP Server | 飞书 API + 本地搜索 + `index_file` 增量索引 |
| feishu-docx | `pip install feishu-docx` | 飞书文档高质量导出 |
| wechat-article-to-markdown | `pipx install wechat-article-to-markdown` | 微信公众号文章抓取（含图片） |
| Obsidian | 已有 | Wiki 前端 IDE |

### feishu-docx 配置

```bash
# 安装
pip install feishu-docx

# 配置（复用 MCP 的飞书应用凭证）
feishu-docx config set --app-id "YOUR_APP_ID" --app-secret "YOUR_APP_SECRET"

# 验证
feishu-docx export "https://xxx.feishu.cn/wiki/xxx" -o /tmp/test/
```

配置文件保存在 `~/.feishu-docx/config.json`，使用 tenant_access_token 认证模式。

### 与 Work Wiki 相关的 MCP 能力

| 工具 | 功能 |
|------|------|
| `list_wiki_spaces` | 列出当前应用可访问的所有知识空间（发现 space_id） |
| `get_wiki_nodes` | 获取节点列表，支持 `recursive` 递归展开完整文档树 |
| `get_wiki_node_content` | 只需 `node_token` 即可获取文档内容（无需 space_id，使用 get_node API） |
| `index_file` | 单文件增量索引（解析→分 chunk→FTS5→自动 embedding），写入文件后立即调用确保可搜索 |
| `list_bitable_fields` | 列出多维表格所有字段 |
| `create_bitable_field` | 创建新字段 |
| `update_bitable_field` | 更新字段属性 |
| `delete_bitable_field` | 删除字段 |

另外修复了 tokenizer 文档/查询侧分词不对称问题（统一使用 `jieba.cutForSearch`），提升中文复合词搜索召回率。

代码变更：`src/crawlers/local-crawler.ts`、`src/storage/database.ts`、`src/server.ts`、`src/utils/tokenizer.ts`

## 使用示例

### 收录飞书文档
```
"把这个存进知识库：https://beike.feishu.cn/wiki/xxx"
```

### 收录微信公众号文章
```
"把这篇文章收录进知识库：https://mp.weixin.qq.com/s/xxx"
```
自动使用 wechat-article-to-markdown 抓取，保留图片。

### 收录其他网页文章
```
"把这个存进知识库：https://example.com/article"
```

### 批量收录知识空间
```
"把飞书知识空间 xxx 里的文档都收录进来"
```

### 查询
```
"AI时代人才应该具备哪些核心能力，怎么评价"
"深蓝项目的整体推进节奏是怎样的"
"供应链安全有哪些典型事件"
```

### 健康检查
```
"对知识库做一次健康检查"
```

## 设计文档

详细设计 spec 见：`docs/specs/2026-04-08-work-wiki-design.md`
