# 快速开始指南

## 三步上手

```bash
# 1. 安装 + 构建
npm install && npm run build

# 2. 索引文档 + 生成向量
npm run index
npm run embed

# 3. 启动服务
npm start
```

## 配置 AI 客户端

在 Cherry Studio / Cursor / Claude Desktop 中添加 MCP Server：

```json
{
  "personal-knowledge": {
    "command": "node",
    "args": ["/absolute/path/to/personal-knowledge-mcp/dist/index.js"],
    "cwd": "/absolute/path/to/personal-knowledge-mcp"
  }
}
```

路径必须是绝对路径。配置后重启客户端。

## 试用搜索

在 AI 对话中输入：

```
搜索知识库中关于 "数据安全" 的文档
```

```
列出最近更新的 10 个文档
```

```
获取知识库统计信息
```

AI 会自动调用 MCP 工具进行混合检索（关键词 + 语义）。

## 日常使用

```bash
# 文档有变更时，重新索引（增量，只处理变更文件）
npm run index

# 新文档需要生成向量（只处理没有 embedding 的 chunks）
npm run embed
```

## 配置说明

编辑 `config.json` 调整索引范围：

```json
{
  "local": {
    "watch_paths": ["~/Documents", "~/Desktop"],
    "file_extensions": [".txt", ".md", ".pdf", ".docx", ".pptx"],
    "exclude_patterns": ["**/node_modules/**", "**/.git/**"]
  }
}
```

修改后重新运行 `npm run index` 和 `npm run embed`。

## 飞书集成

在 `config.json` 中启用飞书：

```json
{
  "feishu": {
    "enabled": true,
    "app_id": "your_app_id",
    "app_secret": "your_app_secret"
  }
}
```

启用后 MCP Server 会自动注册飞书相关工具（多维表格、电子表格、知识库、云文档等）。

## 常见问题

**Q: 索引很慢？**
减少 `watch_paths` 范围。增量索引只处理变更文件，第二次运行会快很多。

**Q: embed 命令退出时报 mutex 错误？**
Node.js v24 + onnxruntime 的已知兼容性问题，不影响功能，embedding 已正常写入。

**Q: 搜索结果不理想？**
确认已运行 `npm run embed` 生成向量索引。混合搜索（关键词 + 语义）比纯关键词搜索效果好很多。

详细文档见 [README.md](./README.md)。
