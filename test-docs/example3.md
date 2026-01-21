# MCP 协议介绍

Model Context Protocol (MCP) 是一种用于 AI 应用与外部工具通信的协议。

## 核心概念

### Tools (工具)
工具是 MCP Server 提供给 AI 的可调用函数。每个工具需要定义：
- name: 工具名称
- description: 功能描述
- inputSchema: 输入参数的 JSON Schema

### Resources (资源)
资源是 MCP Server 可以提供的数据源。

### Prompts (提示)
预定义的提示模板。

## 实现一个 MCP Server

使用官方 SDK：

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

const server = new Server({
  name: 'my-server',
  version: '1.0.0',
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: [...] };
});
```

## 与 Cherry Studio 集成

在配置文件中添加：

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["path/to/server.js"]
    }
  }
}
```
