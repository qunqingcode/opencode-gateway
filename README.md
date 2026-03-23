# OpenCode Gateway

[![Version](https://img.shields.io/badge/version-3.1.0-blue.svg)](https://github.com/your-org/opencode-gateway)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

> **MCP Bridge** — 让 AI 在飞书里操作你的 DevOps 工具

## 🎯 这是什么？

一个连接 **飞书** 和 **OpenCode AI** 的网关服务，采用声明式配置和分层架构设计。

**一句话定位**：飞书版的 Claude Desktop，专门连接 GitLab 和禅道。

**核心功能**：
- 🤖 **智能对话**：在飞书聊天，AI 帮你修改代码、查询 Bug、创建 MR
- ✅ **审批流程**：敏感操作推送飞书卡片，确认后才执行
- 🔌 **MCP 工具**：统一 HTTP 服务暴露 MCP 工具
- 🔗 **第三方集成**：支持接入任意 STDIO 模式的 MCP Server

---

## 📐 架构

参考 OpenClaw 的分层设计：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         OpenCode Gateway 架构                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Gateway 层（纯路由）                                                       │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ • Session 管理 • 消息路由 • MCP 工具调度                            │   │
│   │ • 不思考、不推理、不决策                                             │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│            ┌───────────────────────┼───────────────────────┐               │
│            ▼                       ▼                       ▼               │
│   ┌────────────────┐     ┌────────────────┐     ┌────────────────┐        │
│   │ Channel 层     │     │ MCP Server 层  │     │ API 层         │        │
│   │                │     │                │     │                │        │
│   │ • 消息格式转换 │     │ • 工具定义     │     │ • API 封装     │        │
│   │ • 路由规则     │     │ • 审批流程     │     │ • 纯函数调用   │        │
│   │ • 不依赖 API   │     │ • 调用 API     │     │ • 无业务逻辑   │        │
│   └────────────────┘     └────────────────┘     └────────────────┘        │
│                                                                             │
│   ┌──────────┐           ┌──────────┐           ┌──────────┐              │
│   │ Feishu   │           │ Zentao   │           │ GitLab   │              │
│   │ Channel  │           │ MCP      │           │ MCP      │              │
│   └──────────┘           └──────────┘           └──────────┘              │
│                                  │                       │                 │
│                                  ▼                       ▼                 │
│                          ┌──────────┐           ┌──────────┐              │
│                          │ Zentao   │           │ GitLab   │              │
│                          │ Client   │           │ Client   │              │
│                          └──────────┘           └──────────┘              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📂 项目结构

```
opencode-gateway/
├── index.ts                    # 声明式配置入口
├── src/
│   ├── app.ts                  # 应用核心（自动编排）
│   ├── types.ts                # 统一类型定义
│   │
│   ├── channels/               # Channel 层 - 消息适配
│   │   ├── index.ts            #   Channel 注册
│   │   ├── types.ts            #   类型定义
│   │   └── feishu/             #   飞书 Channel
│   │
│   ├── gateway/                # Gateway 层 - 纯路由
│   │   ├── index.ts            #   Gateway 主入口
│   │   ├── session.ts          #   Session 管理
│   │   ├── mcp-client.ts       #   MCP 客户端
│   │   └── unified-mcp-server.ts
│   │
│   ├── mcp-servers/            # MCP Server 层 - 工具定义
│   │   ├── index.ts            #   Server 注册
│   │   ├── base.ts             #   基础类
│   │   ├── types.ts            #   类型定义
│   │   ├── gitlab/             #   GitLab MCP
│   │   ├── zentao/             #   禅道 MCP
│   │   ├── workflow/           #   工作流 MCP
│   │   └── stdio/              #   第三方 MCP 代理
│   │
│   ├── api/                    # API 层 - 纯 API 调用
│   │   ├── base.ts             #   BaseClient
│   │   ├── index.ts            #   统一导出
│   │   ├── feishu/             #   飞书 API + 卡片
│   │   ├── gitlab/             #   GitLab API
│   │   └── zentao/             #   禅道 API
│   │
│   └── utils/
│       ├── logger.ts           #   日志
│       └── http-client.ts      #   HTTP 客户端
```

---

## 🚀 快速开始

### 1. 安装

```bash
npm install
```

### 2. 配置

```bash
cp .env.example .env
```

编辑 `.env`：

```ini
# 飞书（必需）
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxx

# OpenCode AI（必需）
OPENCODE_API_URL=http://127.0.0.1:4096
OPENCODE_MODEL_ID=glm-4.7
OPENCODE_PROVIDER_ID=venus-coding-ai

# GitLab（可选）
GITLAB_URL=https://gitlab.example.com/api/v4
GITLAB_TOKEN=glpat-xxxxxxxx
GITLAB_PROJECT_ID=123

# 禅道（可选）
ZENTAO_BASE_URL=https://zentao.example.com/api.php/v1
ZENTAO_ACCOUNT=your-username
ZENTAO_PASSWORD=your-password
ZENTAO_PROJECT_ID=1

# 飞书官方 MCP（可选）
LARK_MCP_APP_ID=cli_xxx
LARK_MCP_APP_SECRET=xxx
```

### 3. 启动

```bash
npm run build
npm start
```

### 4. 配置 OpenCode

编辑 `~/.config/opencode/opencode.json`：

```json
{
  "mcp": {
    "opencode-gateway": {
      "type": "remote",
      "url": "http://localhost:3100/mcp",
      "enabled": true
    }
  }
}
```

### 5. 验证

```bash
opencode mcp list
```

---

## 🔌 内置 MCP 工具

### 禅道 (zentao.*)

| 工具 | 需要审批 | 说明 |
|------|:--------:|------|
| `zentao.get_bug` | ❌ | 查询 Bug 详情 |
| `zentao.list_bugs` | ❌ | 查询 Bug 列表 |
| `zentao.create_bug` | ✅ | 创建 Bug |
| `zentao.close_bug` | ✅ | 关闭 Bug |
| `zentao.add_comment` | ❌ | 添加评论 |

### GitLab (gitlab.*)

| 工具 | 需要审批 | 说明 |
|------|:--------:|------|
| `gitlab.get_branches` | ❌ | 获取分支列表 |
| `gitlab.get_merge_requests` | ❌ | 获取 MR 列表 |
| `gitlab.create_mr` | ✅ | 创建 Merge Request |
| `gitlab.create_branch` | ❌ | 创建分支 |

### 工作流 (workflow.*)

| 工具 | 需要审批 | 说明 |
|------|:--------:|------|
| `workflow.get_linked_bugs` | ❌ | 从 MR 描述提取关联 Bug |
| `workflow.merge_and_close_bug` | ✅ | 合并 MR 并关闭关联 Bug |
| `workflow.create_mr_for_bug` | ✅ | 为 Bug 创建修复分支和 MR |

---

## 🔗 接入第三方 MCP

### 飞书官方 MCP

```ini
# .env
LARK_MCP_APP_ID=cli_xxx
LARK_MCP_APP_SECRET=xxx
```

自动启用，无需额外配置。

### 其他 MCP Server

编辑 `index.ts`：

```typescript
mcpServers: {
  // GitHub MCP
  github: {
    enabled: !!(process.env.GITHUB_TOKEN),
    type: 'stdio',
    command: () => ['npx', '-y', '@modelcontextprotocol/server-github'],
  },
  
  // 文件系统 MCP
  filesystem: {
    enabled: true,
    type: 'stdio',
    command: () => ['npx', '-y', '@modelcontextprotocol/server-filesystem', '/path/to/folder'],
  },
}
```

### 支持的第三方 MCP

| MCP Server | npm 包 | 说明 |
|------------|--------|------|
| GitHub | `@modelcontextprotocol/server-github` | GitHub 仓库操作 |
| GitLab | `@modelcontextprotocol/server-gitlab` | GitLab 操作 |
| PostgreSQL | `@modelcontextprotocol/server-postgres` | 数据库查询 |
| Filesystem | `@modelcontextprotocol/server-filesystem` | 文件系统 |
| Puppeteer | `@modelcontextprotocol/server-puppeteer` | 浏览器自动化 |

---

## 📡 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/mcp` | POST | MCP JSON-RPC 入口 |
| `/tools` | GET | 工具列表 |
| `/health` | GET | 健康检查 |

---

## ✅ 审批流程

敏感操作会推送飞书卡片，用户确认后才执行：

```
用户: 帮我创建一个 MR，从 feature/xxx 合并到 main
    │
    ▼
AI: 调用 gitlab.create_mr 工具
    │
    ▼
Gateway: 推送飞书审批卡片
    ┌────────────────────────────────┐
    │ 🔀 创建 MR 确认                 │
    │                                │
    │ 源分支: feature/xxx            │
    │ 目标分支: main                 │
    │                                │
    │ [✅ 确认创建]  [❌ 取消]         │
    └────────────────────────────────┘
    │
    ├─ 用户点击 [确认创建]
    │       │
    │       ▼
    │   创建 MR → 返回链接
    │
    └─ 用户点击 [取消]
            │
            ▼
        操作已取消
```

---

## 📚 文档

| 文档 | 说明 |
|------|------|
| [二次开发指南](./docs/development-guide.md) | 接入 IM、API Client、MCP Server |
| [集成第三方 MCP](./docs/integrate-third-party-mcp.md) | 快速集成官方 MCP Server |
| [系统架构流程图](./docs/system-architecture-flow.md) | 详细架构说明 |
| [变更日志](./CHANGELOG.md) | 版本更新记录 |

---

## 🔧 设计原则

参考 OpenClaw 的架构设计：

| 原则 | 说明 |
|------|------|
| **Gateway 不思考** | 只做路由和 Session 管理 |
| **Channel 不依赖 API** | 通过注入获得能力 |
| **API Client 是纯函数** | 只封装 API，不包含业务 |
| **MCP Server 是业务层** | 定义工具、审批流程 |

---

## 🛠️ 开发命令

```bash
npm run build        # 编译
npm run dev          # 开发模式
npm run typecheck    # 类型检查
npm run rebuild      # 清理并重新编译
```

---

## 📜 License

MIT