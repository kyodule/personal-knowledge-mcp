# 快速开始指南

## 三步上手

```bash
# 1. 安装 + 构建
npm install && npm run build

# 2. 索引文档（自动生成向量）
npm run index

# 3. 启动服务
npm start
```

这三步建立的是“本地文件可搜索”的 MCP 能力。

- 本地文件会进入 SQLite 索引，并支持 `search_documents`
- 飞书部分是独立工具集，不会自动同步进本地搜索

如果你要先看当前项目全貌，再执行命令，优先阅读 [`PROJECT_STATUS.md`](./PROJECT_STATUS.md)。

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

这里默认搜索的是已经建立本地索引的文件。

## 日常使用

```bash
# 文档有变更时，重新索引（增量，自动生成向量）
npm run index
```

> `npm run embed` 仍可单独使用，用于补跑历史文档的向量。日常使用无需手动调用。

如果只是刚新增一个文件，并且希望它立刻可被搜索：

- 直接在 MCP 客户端里调用 `index_file`

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

修改后重新运行 `npm run index` 即可（自动包含向量生成）。

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

注意：

- 飞书工具是“直接调飞书 API”
- 它们不会自动把飞书内容同步到本地 SQLite 搜索索引
- 如果需要纳入本地搜索，建议走 Work Wiki 收录流程或先导出为本地文件

### 知识库使用

```
列出我可以访问的飞书知识空间
```

```
获取知识空间 7561364012530434051 的完整文档树
```

```
获取这个知识库文档的内容：https://xxx.feishu.cn/wiki/CwrFwxs7jigxPYkVHWHc1wb6nPh
```

知识库工具说明：
- `list_wiki_spaces` — 发现可用的知识空间及 space_id
- `get_wiki_nodes` — 获取节点列表，支持 `recursive: true` 递归获取完整文档树
- `get_wiki_node_content` — 只需 node_token 即可获取文档内容，无需 space_id

## 常见问题

**Q: 索引很慢？**
减少 `watch_paths` 范围。增量索引只处理变更文件，第二次运行会快很多。

**Q: embed 命令退出时报 mutex 错误？**
Node.js v24 + onnxruntime 的已知兼容性问题，不影响功能，embedding 已正常写入。

**Q: 搜索结果不理想？**
确认已运行 `npm run index`（自动生成向量索引）。混合搜索（关键词 + 语义）比纯关键词搜索效果好很多。如有历史文档缺少向量，可单独运行 `npm run embed` 补跑。

**Q: `npm run sync` 能直接同步飞书吗？**
当前不能。脚本仍是预留入口，项目当前可用的主流程仍是：
- 本地文件：`npm run index`
- 单文件快速可搜：`index_file`
- 飞书资源：通过 MCP 飞书工具按需读取/写入

详细文档见 [README.md](./README.md) 和 [PROJECT_STATUS.md](./PROJECT_STATUS.md)。
