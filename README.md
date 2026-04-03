# OpenCode Gateway

[![Version](https://img.shields.io/badge/version-4.0.0-blue.svg)](https://github.com/your-org/opencode-gateway)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

> **七层架构网关** — 让 AI 在飞书里操作你的 DevOps 工具，支持工作流引擎和第三方 MCP 集成

## 🎯 这是什么？

一个连接 **飞书** 和 **OpenCode AI** 的网关服务，采用七层架构设计。

**核心功能**：
- 🤖 **智能对话**：在飞书聊天，AI 帮你修改代码、查询 Bug、创建 MR
- ✅ **审批流程**：敏感操作推送飞书卡片，确认后才执行
- 🔀 **工作流引擎**：预定义多步骤工作流（Bug 修复、周报生成等）
- 🔌 **MCP 工具**：支持 MCP 和 CLI 两种调用方式
- 🌐 **第三方 MCP 集成**：动态代理飞书官方、GitHub、GitLab 等 MCP Server
- 🔗 **可扩展**：清晰的分层架构，易于扩展

---

## 📐 架构

七层架构：`callers/ → gateway/ → agents/ + tools/ + flow/ → channels/ + clients/`

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
│                      │      │   Cron / MCP Proxy   │
└──────────┬───────────┘      └──────────┬───────────┘
           │                               │
           └───────────────┬───────────────┘
                           │
           ┌───────────────┴───────────────┐
           │                               │
           ▼                               ▼
┌──────────────────────┐      ┌──────────────────────┐      ┌──────────────────────┐
│  channels（渠道层）   │      │  clients（客户端层） │      │   flow（工作流层）   │
│  飞书 Channel        │      │  GitLab / 禅道       │      │   Flow 引擎          │
│  有连接、有状态      │      │  纯 API、无状态      │      │   预定义工作流       │
└──────────────────────┘      └──────────────────────┘      └──────────────────────┘
```

### 层级说明

| 层级 | 职责 | 特点 |
|------|------|------|
| **callers** | 调用入口 | MCP / CLI |
| **gateway** | 消息路由 | 协调各层 |
| **agents** | AI 对话 | OpenCode / Claude Code |
| **tools** | 业务逻辑 | GitLab / 禅道 / Workflow / Feishu / Cron / MCP Proxy |
| **channels** | IM 渠道 | 有连接、有状态 |
| **clients** | API 客户端 | 无状态 |
| **flow** | 工作流引擎 | 预定义多步骤流程 |

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
│   ├── cron.ts                  # 定时任务工具
│   ├── flow.ts                  # Flow 执行工具
│   └── mcp-proxy.ts             # 第三方 MCP 代理
│
├── flow/                        # 工作流层：Flow 引擎
│   ├── index.ts                 # FlowManager
│   ├── engine.ts                # FlowEngine
│   ├── registry.ts              # FlowRegistry
│   └── types.ts                 # Flow 类型定义
│
├── gateway/                     # 网关层：消息路由
│   ├── index.ts                 # Gateway 主类
│   ├── session.ts               # Session 管理
│   ├── approval-controller.ts   # 审批流程控制
│   ├── cron-scheduler.ts        # 定时任务调度
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

# 第三方 MCP Server（可选）
# 飞书官方 MCP（文档、多维表格等）
LARK_MCP_APP_ID=cli_xxxxxxxxxxxx
LARK_MCP_APP_SECRET=xxxxxxxxxxxxxxxxxxxx

# GitHub MCP
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
GITHUB_MCP_ENABLED=true

# GitLab MCP
GITLAB_MCP_ENABLED=true
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

### Flow 引擎 (flow.*)

| 工具 | 说明 |
|------|------|
| `flow.execute` | 执行预定义工作流 |

**内置工作流示例**：
- `bug-fix-workflow`：自动修复 Bug（查询 → 创建分支 → AI 分析修复 → 创建 MR）
- `weekly-report`：自动生成周报（汇总 Git 提交、任务、MR）

### 第三方 MCP Server 工具

通过 MCP Proxy 动态集成第三方 MCP Server，每个工具自动注册为独立工具。

**支持的 MCP Server**：

| MCP Server | 工具前缀 | 说明 |
|------------|---------|------|
| 飞书官方 MCP (`@larksuiteoapi/lark-mcp`) | `lark.*` | 文档、多维表格、Wiki 等 |
| GitHub MCP | `github.*` | 仓库、Issues、PR 管理 |
| GitLab MCP | `gitlab_mcp.*` | 官方 GitLab MCP 工具 |
| PostgreSQL MCP | `postgres.*` | 数据库操作 |
| Filesystem MCP | `fs.*` | 文件系统操作 |

**工具自动发现**：启动时自动扫描 MCP Server 并注册所有工具，无需手动配置。

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
gateway flow.execute --flowName bug-fix-workflow --params '{"bugId":123}'  # 执行工作流
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
    │ 🔀 创建 MR 认                 │
    │                                │
    │ 源分支: feature/xxx            │
    │ 目标分支: main                 │
    │                                │
    │ [✅ 确认创建]  [❌ 取消]         │
    └────────────────────────────────┘
```

---

## 🔀 工作流引擎

Flow 引擎支持预定义多步骤工作流，简化复杂操作。

### 使用方式

用户只需一句话，AI 自动调用 `flow.execute` 工具：

```
用户: "修复 Bug #123"
AI: 调用 flow.execute(flowName="bug-fix-workflow", params={"bugId": 123})
```

### 工作流定义

工作流模板存储在 `data/flows/` 目录（YAML 格式）：

```yaml
name: bug-fix-workflow
description: 自动修复 Bug 工作流
params:
  bugId: { type: number, required: true }
steps:
  - name: get_bug
    tool: zentao.get_bug
    params: { bugId: "${bugId}" }
  - name: create_branch
    tool: gitlab.create_branch
    params: { name: "fix/bug-${bugId}", ref: "main" }
  - name: ai_fix
    agent: opencode
    prompt: "修复 Bug: ${get_bug.title}"
  - name: create_mr
    tool: gitlab.create_mr
    params:
      sourceBranch: "fix/bug-${bugId}"
      targetBranch: "main"
      title: "Fix Bug #${bugId}"
```

---

## 🌐 第三方 MCP 集成

### 配置方式

在 `.env` 中启用第三方 MCP Server：

```ini
# 飞书官方 MCP（文档、多维表格）
LARK_MCP_APP_ID=cli_xxxxxxxxxxxx
LARK_MCP_APP_SECRET=xxxxxxxxxxxxxxxxxxxx

# GitHub MCP
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
GITHUB_MCP_ENABLED=true

# 自定义 MCP Server（JSON 格式）
CUSTOM_MCP_SERVERS={"my_tool":{"enabled":true,"command":["npx","-y","my-mcp-server"],"description":"My custom MCP"}}
```

### 工具自动发现

启动时自动：
1. 启动 MCP Server 子进程（STDIO 模式）
2. 调用 `tools/list` 发现所有工具
3. 为每个工具创建独立代理（前缀命名）
4. 注册到 ToolRegistry

**示例**：启用 GitHub MCP 后，自动注册：
- `github.search_repositories`
- `github.create_issue`
- `github.get_issue`
- ...

---

## 🔧 开发命令

```bash
npm run build        # 编译
npm run dev          # 开发模式
npm run typecheck    # 类型检查
npm test             # 运行测试
npm run test:coverage # 测试覆盖率
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
    name: 'namespace.action',
    description: '工具描述',
    inputSchema: {
      type: 'object',
      properties: {
        param1: { type: 'string', description: '参数说明' },
      },
      required: ['param1'],
    },
    requiresApproval: false,  // 敏感操作设为 true
  };

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const param1 = args.param1 as string;
    // 业务逻辑
    return this.success({ result: 'done' });
  }
}
```

### 添加新工作流

在 `data/flows/my-workflow.yaml` 创建：

```yaml
name: my-workflow
description: 我的自定义工作流
params:
  input: { type: string, required: true }
steps:
  - name: step1
    tool: some.tool
    params: { data: "${input}" }
  - name: step2
    agent: opencode
    prompt: "处理: ${step1.result}"
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

### 集成第三方 MCP Server

修改 `.env` 配置：

```ini
CUSTOM_MCP_SERVERS={"custom_name":{"enabled":true,"command":["npx","-y","custom-mcp-server"],"description":"Custom MCP Server"}}
```

---

## 📜 License

MIT