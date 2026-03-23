# 集成第三方 MCP Server

通过 `StdioMCPServer` 代理，可以集成任何 STDIO 模式的 MCP Server。

## 快速集成

### 飞书官方 MCP

```ini
# .env
LARK_MCP_APP_ID=cli_xxx
LARK_MCP_APP_SECRET=xxx
```

```typescript
// index.ts
mcpServers: {
  lark: {
    enabled: !!(process.env.LARK_MCP_APP_ID),
    type: 'stdio',
    command: () => [
      'npx', '-y', '@larksuiteoapi/lark-mcp', 'mcp',
      '-a', process.env.LARK_MCP_APP_ID!,
      '-s', process.env.LARK_MCP_APP_SECRET!,
    ],
  },
}
```

### GitHub MCP

```typescript
mcpServers: {
  github: {
    enabled: !!(process.env.GITHUB_TOKEN),
    type: 'stdio',
    command: () => ['npx', '-y', '@modelcontextprotocol/server-github'],
  },
}
```

### 文件系统 MCP

```typescript
mcpServers: {
  filesystem: {
    enabled: true,
    type: 'stdio',
    command: () => ['npx', '-y', '@modelcontextprotocol/server-filesystem', '/path/to/folder'],
  },
}
```

### PostgreSQL MCP

```typescript
mcpServers: {
  postgres: {
    enabled: !!(process.env.DATABASE_URL),
    type: 'stdio',
    command: () => ['npx', '-y', '@modelcontextprotocol/server-postgres', process.env.DATABASE_URL!],
  },
}
```

## 官方 MCP Server 列表

| MCP Server | npm 包 | 说明 |
|------------|--------|------|
| GitHub | `@modelcontextprotocol/server-github` | GitHub 仓库操作 |
| GitLab | `@modelcontextprotocol/server-gitlab` | GitLab 操作 |
| PostgreSQL | `@modelcontextprotocol/server-postgres` | 数据库查询 |
| SQLite | `@modelcontextprotocol/server-sqlite` | SQLite 数据库 |
| Filesystem | `@modelcontextprotocol/server-filesystem` | 文件系统 |
| Puppeteer | `@modelcontextprotocol/server-puppeteer` | 浏览器自动化 |
| Brave Search | `@modelcontextprotocol/server-brave-search` | 网页搜索 |
| Google Drive | `@modelcontextprotocol/server-gdrive` | Google Drive |
| Slack | `@modelcontextprotocol/server-slack` | Slack 消息 |

## 可用工具示例

集成飞书官方 MCP 后，OpenCode 可以调用：

| 工具 | 说明 |
|------|------|
| `lark.create_doc` | 创建飞书文档 |
| `lark.search_doc` | 搜索飞书文档 |
| `lark.create_bitable` | 创建多维表格 |
| `lark.send_message` | 发送飞书消息 |
| `lark.get_calendar_events` | 获取日历事件 |

## 工作原理

```
OpenCode Gateway (HTTP:3100)
       │
       ▼
  MCPClient
       │
       └─► StdioMCPServer (代理)
              │
              ▼
         npx @xxx/mcp-server (子进程)
              │
              ▼
         JSON-RPC (stdio)
```

## 注意事项

1. 首次运行会下载 npm 包
2. 子进程会在 Gateway 关闭时自动退出
3. 如果子进程崩溃，工具将不可用
4. 确保 `npx` 可用（Node.js 自带）