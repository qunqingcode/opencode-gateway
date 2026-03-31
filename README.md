# OpenCode Gateway

[![Version](https://img.shields.io/badge/version-4.0.0-blue.svg)](https://github.com/your-org/opencode-gateway)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

> **六层架构网关** — 让 AI 在飞书里操作你的 DevOps 工具

## 🎯 这是什么？

一个连接 **飞书** 和 **OpenCode AI** 的网关服务，采用六层架构设计。

**核心功能**：
- 🤖 **智能对话**：在飞书聊天，AI 帮你修改代码、查询 Bug、创建 MR
- ✅ **审批流程**：敏感操作推送飞书卡片，确认后才执行
- 🔌 **MCP 工具**：支持 MCP 和 CLI 两种调用方式
- 🔗 **可扩展**：清晰的分层架构，易于扩展

---

## 📐 架构

六层架构：`callers/ → gateway/ → agents/ + tools/ → channels/ + clients/`

```
┌─────────────────────────────────────────────────────────────┐
│                    callers（调用层）                         │
│              MCP HTTP Server / CLI 命令                      │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    gateway（网关层）                         │
│         消息路由 / Session 管理 / 协调各层                   │
└──────────┬───────────────────────────────┬─────────────────┘
           │                               │
           ▼                               ▼
┌──────────────────────┐      ┌──────────────────────┐
│   agents（Agent层）   │      │   tools（工具层）    │
│   OpenCode Agent     │      │   GitLab / 禅道      │
│   Claude Code (扩展) │      │   Workflow / Feishu  │
│                      │      │   Cron               │
└──────────┬───────────┘      └──────────┬───────────┘
           │                               │
           └───────────────┬───────────────┘
                           │
           ┌───────────────┴───────────────┐
           │                               │
           ▼                               ▼
┌──────────────────────┐      ┌──────────────────────┐
│  channels（渠道层）   │      │  clients（客户端层） │
│  飞书 Channel        │      │  GitLab / 禅道       │
│  有连接、有状态      │      │  纯 API、无状态      │
└──────────────────────┘      └──────────────────────┘
```

### 层级说明

| 层级 | 职责 | 特点 |
|------|------|------|
| **callers** | 调用入口 | MCP / CLI |
| **gateway** | 消息路由 | 协调各层 |
| **agents** | AI 对话 | OpenCode / Claude Code |
| **tools** | 业务逻辑 | GitLab / 禅道 / Workflow |
| **channels** | IM 渠道 | 有连接、有状态 |
| **clients** | API 客户端 | 无状态 |

---

## 📂 项目结构

```
src/
├── channels/                    # 渠道层：IM 连接和消息
│   ├── index.ts
│   ├── types.ts                 # IChannel 接口
│   └── feishu/                  # 飞书 Channel
│       ├── index.ts             # FeishuChannel
│       ├── send.ts              # 消息发送
│       ├── receive.ts           # 消息接收
│       └── card/                # 卡片构建
│
├── clients/                     # 客户端层：纯 API 封装
│   ├── index.ts
│   ├── base.ts                  # BaseClient 基类
│   ├── gitlab/                  # GitLab API
│   └── zentao/                  # 禅道 API
│
├── agents/                      # Agent 层：AI 对话能力
│   ├── index.ts
│   ├── interface.ts             # IAgent 接口
│   ├── factory.ts               # Agent 工厂
│   └── opencode/                # OpenCode 实现
│
├── tools/                       # 工具层：业务逻辑
│   ├── index.ts
│   ├── base.ts                  # BaseTool 基类
│   ├── types.ts                 # 工具类型
│   ├── registry.ts              # ToolRegistry
│   ├── gitlab.ts                # GitLab 工具
│   ├── zentao.ts                # 禅道工具
│   ├── workflow.ts              # 工作流工具
│   ├── feishu.ts                # 飞书消息发送工具
│   └── cron.ts                  # 定时任务工具
│
├── gateway/                     # 网关层：消息路由
│   ├── index.ts                 # Gateway 主类
│   ├── session.ts               # Session 管理
│   └── types.ts                 # Gateway 类型
│
├── callers/                     # 调用层
│   ├── index.ts
│   ├── mcp/                     # MCP HTTP Server
│   └── cli/                     # CLI 入口
│
├── config/                      # 配置
├── utils/                       # 工具函数
└── types.ts                     # 全局类型
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

---

## 🔌 内置工具

### GitLab (gitlab.*)

| 工具 | 需要审批 | 说明 |
|------|:--------:|------|
| `gitlab.get_branches` | ❌ | 获取分支列表 |
| `gitlab.get_merge_requests` | ❌ | 获取 MR 列表 |
| `gitlab.create_mr` | ✅ | 创建 Merge Request |
| `gitlab.create_branch` | ❌ | 创建分支 |

### 禅道 (zentao.*)

| 工具 | 需要审批 | 说明 |
|------|:--------:|------|
| `zentao.get_bug` | ❌ | 查询 Bug 详情 |
| `zentao.get_bugs` | ❌ | 查询 Bug 列表 |
| `zentao.close_bug` | ✅ | 关闭 Bug |
| `zentao.add_comment` | ❌ | 添加评论 |

### 工作流 (workflow.*)

| 工具 | 需要审批 | 说明 |
|------|:--------:|------|
| `workflow.get_linked_bugs` | ❌ | 从 MR 描述提取关联 Bug |
| `workflow.merge_and_close_bug` | ✅ | 合并 MR 并关闭关联 Bug |
| `workflow.create_mr_for_bug` | ✅ | 为 Bug 创建修复分支和 MR |

### 飞书 (feishu.*)

| 工具 | 说明 |
|------|------|
| `feishu.send_file` | 发送文件 |
| `feishu.send_image` | 发送图片 |
| `feishu.send_rich_text` | 发送富文本（文本+图片） |

### 定时任务 (cron.*)

| 工具 | 说明 |
|------|------|
| `cron.list` | 列出定时任务 |
| `cron.create` | 创建定时任务 |
| `cron.delete` | 删除定时任务 |
| `cron.enable` | 启用定时任务 |
| `cron.disable` | 禁用定时任务 |
| `cron.run` | 立即执行任务 |

---

## 📡 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/mcp` | POST | MCP JSON-RPC 入口 |
| `/tools` | GET | 工具列表 |
| `/health` | GET | 健康检查 |

---

## 🖥️ CLI 模式

除了 MCP 模式，还支持 CLI 直接调用工具：

```bash
# 启动服务
npm start

# 调用工具（工具名格式: namespace.action）
gateway list                          # 列出所有工具
gateway gitlab.get_branches           # 获取分支
gateway gitlab.get_merge_requests --state open  # 获取 MR
gateway zentao.get_bug --bugId 123   # 查询 Bug
gateway feishu.send_file --filePath /path/to/file  # 发送文件
gateway cron.list                     # 列出定时任务
```

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
```

---

## 🔧 开发命令

```bash
npm run build        # 编译
npm run dev          # 开发模式
npm run typecheck    # 类型检查
```

---

## 📚 扩展开发

### 添加新工具

```typescript
// src/tools/my-tool.ts
import { BaseTool } from './base';
import type { ToolDefinition, ToolResult, ToolContext } from './types';

export class MyTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'my_tool',
    description: '我的工具',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: '操作类型' },
      },
      required: ['action'],
    },
  };

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    return this.success({ message: 'Done' });
  }
}
```

### 添加新 Agent

```typescript
// src/agents/my-agent/index.ts
export class MyAgent implements IAgent {
  readonly name = 'my_agent';
  async createSession(): Promise<string> { ... }
  async sendPrompt(sessionId: string, prompt: string): Promise<string | null> { ... }
}
```

### 添加新 Channel

```typescript
// src/channels/telegram/index.ts
export class TelegramChannel implements IChannel {
  readonly id = 'telegram';
  readonly name = 'Telegram';
  async connect(): Promise<void> { ... }
  onMessage(handler: MessageHandler): void { ... }
}
```

---

## 📜 License

MIT