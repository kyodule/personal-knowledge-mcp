# 快速开始指南

## Phase 1 已完成 ✅

恭喜！你的个人知识库 MCP Server 已经成功搭建完成。

## 现在可以做什么？

### 1. 验证索引结果

你的文档已经被索引到数据库中。数据库位于：
```
./data/knowledge.db
```

### 2. 配置 Cherry Studio

**重要提示**：请根据你使用的 Cherry Studio 版本选择配置方法。

#### 方法 A: 通过 UI 配置（推荐）

1. 打开 Cherry Studio
2. 进入 `设置` → `MCP Servers` 或 `Model Context Protocol`
3. 添加新的 Server 配置：

```json
{
  "personal-knowledge": {
    "command": "node",
    "args": ["/path/to/personal-knowledge-mcp/dist/index.js"],
    "cwd": "/path/to/personal-knowledge-mcp"
  }
}
```

#### 方法 B: 编辑配置文件

Cherry Studio 的配置文件可能在以下位置之一：
- `~/.cherry-studio/config.json`
- `~/Library/Application Support/cherry-studio/config.json`
- 在应用设置中查看配置文件路径

在配置文件中添加 `mcpServers` 字段：

```json
{
  "mcpServers": {
    "personal-knowledge": {
      "command": "node",
      "args": ["/path/to/personal-knowledge-mcp/dist/index.js"],
      "cwd": "/path/to/personal-knowledge-mcp"
    }
  }
}
```

### 3. 重启 Cherry Studio

配置完成后，重启 Cherry Studio 以加载 MCP Server。

### 4. 测试使用

在 Cherry Studio 的对话中尝试：

```
请帮我搜索知识库中关于 "TypeScript 泛型" 的文档
```

```
列出我知识库中最近更新的 10 个文档
```

```
获取知识库的统计信息
```

AI 会自动调用你的 MCP Server 提供的工具。

## 可用的 MCP 工具

你的 Server 提供了以下工具：

1. **search_documents** - 全文搜索文档
2. **get_document** - 获取完整文档内容
3. **list_documents** - 列出所有文档
4. **get_stats** - 获取统计信息
5. **sync_local_documents** - 手动触发同步

## 优化建议

### 减少索引范围（推荐）

如果你不需要索引整个 Documents 目录，可以编辑 `config.json`：

```json
{
  "local": {
    "enabled": true,
    "watch_paths": [
      "./test-docs"
    ],
    ...
  }
}
```

然后重新索引：
```bash
rm data/knowledge.db
npm run index
```

### 排除特定文件类型

如果 PDF 解析有问题或速度慢，可以暂时只索引文本文件：

```json
{
  "local": {
    "file_extensions": [".txt", ".md"]
  }
}
```

## 常见问题

### Q: Cherry Studio 无法连接？

检查：
1. 确认已运行 `npm run build`
2. 路径必须是**绝对路径**
3. 查看 Cherry Studio 的日志输出
4. 确认 Node.js 版本 >= 18

### Q: 搜索不到测试文档？

测试文档在 `test-docs/` 目录下，包含：
- example1.md: TypeScript 泛型指南
- example2.txt: React Hooks 笔记
- example3.md: MCP 协议介绍

尝试搜索："TypeScript"、"React Hooks"、"MCP 协议"

### Q: 如何更新索引？

```bash
npm run index
```

已有文档会被更新，删除的文件会被移除。

## 下一步

现在你已经有了一个可工作的本地知识库！

**Phase 2 和 Phase 3** 将实现：
- 飞书文档同步
- 企业微信文档同步
- 语义搜索（向量化）

如果 Phase 1 符合你的预期，我们可以继续推进。

## 需要帮助？

- 查看完整文档：`README.md`
- 查看数据库统计：`sqlite3 data/knowledge.db "SELECT source, COUNT(*) FROM documents GROUP BY source;"`
- 测试搜索：`sqlite3 data/knowledge.db "SELECT title FROM documents LIMIT 10;"`

---

**重要提示**：在索引企业文档之前，请确认这不违反公司的信息安全政策！
