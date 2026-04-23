# Ingest Prompt 模板（P0-2 配套）

本文件是 LLM 执行 myob vault `Ingest` 工作流时的结构化 prompt。
配合 MCP 工具 `find_similar_pages` 使用，用于消除 concept/entity 命名漂移和重复创建。

> 把本文件复制或引用到 `~/Documents/myob/wiki/_templates/ingest.prompt.md`，
> 然后在 `~/Documents/myob/AGENTS.md` 的 Ingest 章节追加一句：
> "抽取阶段必须使用 wiki/_templates/ingest.prompt.md 中的 JSON schema。"

---

## 抽取阶段：JSON Schema

读完 raw 文档后，输出**严格符合**下列 schema 的 JSON 对象，**不得**输出额外文本：

```json
{
  "summary": "string, 300-500 chars, 一句话主旨 + 关键论点",
  "concepts": [
    {
      "name": "string, ≤ 12 字, 中文优先",
      "rationale": "string, ≤ 60 字, 为什么这是核心概念"
    }
  ],
  "entities": [
    {
      "name": "string, 实体名, 保留专有名词原写法",
      "type": "project | person | team | product | tool",
      "rationale": "string, ≤ 60 字"
    }
  ],
  "tags": ["string"]
}
```

**抽取规则**：
- `concepts`: 3-8 个，每个名称尽量原子化（一个独立想法/方法/流程/架构）
- `entities`: 必须指定 `type`，专有名词保留原写法（"飞书 docx" 不要改成 "Lark Doc"）
- `tags`: 复用 vault 已有标签优先，新建标签需在 rationale 说明

---

## 决策阶段：去重判定

对抽取出的**每个** concept / entity，调用 MCP 工具：

```
find_similar_pages({
  text: "<name>\n<rationale>",
  kind: "concept" | "entity",
  candidate_title: "<name>",
  top_k: 5,
  rerank: false   // 第一次跑可关；信号不够时再开（首次会下载 ~200MB 模型）
})
```

返回 `matches[]`，每项含 `suggested_action`：

| suggested_action | 触发规则 | 处理方式 |
|---|---|---|
| `merge` | 标题 bigram Jaccard ≥ 0.7（强信号） | 合并到该已有页面：追加新内容 + 加反向链接 + 在 frontmatter `aliases:` 加入新名称 |
| `review` | top_k 内但标题 jaccard < 0.7（语义近但命名不同） | 在 `wiki/log.md` 标 `[NEEDS_REVIEW]` 留指针；当前可暂建新页，待人审 |
| `distinct` | 不在 top_k 或所有信号都弱 | 直接新建页面 |

**没有任何 matches** → 直接新建（即 `findSimilarPages` 返回 `matches: []`）。

---

## frontmatter 强制字段

新建/合并页面的 YAML frontmatter 必须包含：

```yaml
---
type: concept | entity | source | synthesis
title: 页面标题
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources: [相关原始文档标题]
tags: [标签1, 标签2]
aliases: []   # ← P0-2 新增。每次合并新候选名时追加，供下次匹配命中
---
```

---

## 完整流程示例

```
1. read raw 文件
2. LLM 输出 JSON（按上方 schema）
3. for each concept c in concepts:
     resp = find_similar_pages({text: c.name + "\n" + c.rationale, kind: "concept", candidate_title: c.name})
     if any m.suggested_action == "merge":
        → append to wiki/concepts/<m.title>.md  + add c.name to aliases
     elif any m.suggested_action == "review":
        → log [NEEDS_REVIEW] in wiki/log.md, then create new page
     else:
        → create wiki/concepts/<c.name>.md
4. 同样处理 entities
5. 创建 wiki/sources/<doc-title>.md（摘要页 + 双链）
6. 更新 wiki/index.md
7. 追加 wiki/log.md
8. 对所有新建/更新的页面调用 index_file
9. 回填飞书 bitable：状态→已编译，填入 summary
```

---

## 何时开 rerank

默认 `rerank: false`（hybrid 召回 + title bigram 已经能覆盖 80% 情况）。
出现以下情况时，把 `rerank: true`：
- 某个 concept 反复被判 `distinct` 但你觉得应该 merge
- vault 已积累 ≥ 200 个 concept 页面（重排提升召回排序更明显）
- 跨语言场景（候选英文，已有页面中文，title bigram 不命中）

注意：首次开启会下载 ~200MB 的 `Xenova/bge-reranker-base`，之后缓存。
