# OpenCode Gateway

> **飞书 AI 智能体网关** — 在飞书聊天，让 AI 帮你改代码、提 MR、管 Bug

## 🎯 这是什么？

一个连接**飞书**和**OpenCode AI**的网关服务，采用三层架构设计。

**核心功能**：
- 🤖 **智能对话**：在飞书聊天，AI 帮你修改代码、查询 Bug、创建 MR
- ✅ **审批流程**：敏感操作（创建 MR、关闭 Bug）会推送飞书卡片，确认后才执行
- 🔌 **MCP 工具**：统一 MCP HTTP 服务，供 OpenCode 调用
- 🔗 **跨平台联动**：支持 GitLab + 禅道工作流（合并 MR 自动关闭 Bug）

---

## 📐 架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         OpenCode Gateway v3.0                                │
│                              三层架构                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                  Layer 1: Channels (渠道适配层)                       │  │
│  │                                                                      │  │
│  │   ┌──────────┐                                                      │  │
│  │   │ Feishu   │ ──消息──► Gateway                                    │  │
│  │   │ Channel  │ ◄──卡片──                                            │  │
│  │   └──────────┘                                                      │  │
│  │                                                                      │  │
│  │   职责：消息收发、卡片推送、飞书 API 封装                               │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                              │                                              │
│                              ▼                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                  Layer 2: Gateway (网关核心层)                        │  │
│  │                                                                      │  │
│  │   ┌────────────┐  ┌────────────┐  ┌─────────────────────────────┐   │  │
│  │   │  Session   │  │   MCP      │  │  Unified MCP HTTP Server    │   │  │
│  │   │  Manager   │  │  Client    │  │  (port 3100)                │   │  │
│  │   │            │  │            │  │                             │   │  │
│  │   │ • 会话映射 │  │ • 工具调度 │  │ • OpenCode Remote MCP       │   │  │
│  │   │ • 上下文   │  │ • 结果聚合 │  │ • 工具列表 / 工具调用        │   │  │
│  │   └────────────┘  └────────────┘  └─────────────────────────────┘   │  │
│  │                                                          ▲           │  │
│  │   职责：会话管理、上下文传递、消息路由、MCP 工具调度        │           │  │
│  └──────────────────────────────────────────────────────────┼───────────┘  │
│                                                             │              │
│                              ▼                              │              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                  Layer 3: MCP Servers (原子能力层)                    │  │
│  │                                                                      │  │
│  │   ┌────────────────┐  ┌────────────────┐  ┌────────────────────┐   │  │
│  │   │ Zentao MCP     │  │ GitLab MCP     │  │ Workflow MCP       │   │  │
│  │   │ Server         │  │ Server         │  │ Server             │   │  │
│  │   │                │  │                │  │                    │   │  │
│  │   │ • get_bug      │  │ • get_branches │  │ • merge_and_close  │   │  │
│  │   │ • list_bugs    │  │ • create_mr ✅ │  │ • create_mr_for_bug│   │  │
│  │   │ • create_bug ✅│  │ • create_branch│  │                    │   │  │
│  │   │ • close_bug ✅ │  │                │  │ 跨平台工作流编排     │   │  │
│  │   └────────────────┘  └────────────────┘  └────────────────────┘   │  │
│  │                                                                      │  │
│  │   职责：封装原子能力，支持审批流程（✅ = 需要审批）                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

                                     OpenCode
                                         │
                                         │ HTTP (Remote MCP)
                                         ▼
                           http://localhost:3100/mcp
```

### 消息流程

```
用户飞书消息 → FeishuChannel → Gateway.processMessage
                                    │
                                    ├─► SessionManager.getOrCreate(chatId)
                                    │       └─► 创建/复用 OpenCode Session
                                    │
                                    ├─► SessionManager.setActiveContext({ chatId, userId, ... })
                                    │       └─► 设置活跃上下文（供 MCP 工具使用）
                                    │
                                    └─► OpenCode SDK → AI 处理
                                              │
                                              └─► AI 调用 MCP 工具
                                                      │
                                                      └─► UnifiedMCPHTTPServer
                                                              │
                                                              ├─► 从 Gateway 获取 chatId
                                                              └─► context.sendCard() → 飞书卡片
```

---

## 📂 项目结构

```
opencode-gateway/
├── index.ts                      # 主入口
├── package.json
├── tsconfig.json
├── .env.example                  # 环境变量示例
│
├── src/
│   ├── config.ts                 # 配置管理
│   │
│   ├── channels/                 # Layer 1: 渠道适配层
│   │   ├── index.ts              #   Channel 注册
│   │   ├── types.ts              #   类型定义
│   │   ├── registry.ts           #   注册表
│   │   └── feishu/               #   飞书 Channel
│   │       └── index.ts
│   │
│   ├── gateway/                  # Layer 2: 网关核心层
│   │   ├── index.ts              #   Gateway 主入口
│   │   ├── types.ts              #   类型定义
│   │   ├── context.ts            #   活跃上下文类型
│   │   ├── session.ts            #   Session 管理 + 上下文管理
│   │   ├── mcp-client.ts         #   MCP 客户端
│   │   └── unified-mcp-server.ts #   统一 MCP HTTP 服务
│   │
│   ├── mcp-servers/              # Layer 3: MCP 原子能力层
│   │   ├── index.ts              #   MCP Server 注册
│   │   ├── types.ts              #   类型定义
│   │   ├── base.ts               #   基础类
│   │   ├── zentao/               #   禅道 MCP Server
│   │   ├── gitlab/               #   GitLab MCP Server
│   │   └── workflow/             #   工作流 MCP Server（跨平台）
│   │
│   ├── providers/                # Provider 实现（底层 SDK）
│   │   ├── feishu/               #   飞书 SDK 封装
│   │   │   ├── index.ts
│   │   │   ├── send.ts
│   │   │   ├── receive.ts
│   │   │   └── card/             #   飞书卡片构建
│   │   ├── opencode/             #   OpenCode SDK 封装
│   │   ├── gitlab/               #   GitLab SDK 封装
│   │   └── zentao/               #   禅道 SDK 封装
│   │
│   └── utils/                    # 工具模块
│       ├── logger.ts
│       └── http-client.ts
│
└── logs/                         # 日志目录
```

---

## 🚀 快速开始

### 1. 安装

```bash
npm install
```

### 2. 配置

复制 `.env.example` 为 `.env`：

```bash
cp .env.example .env
```

编辑 `.env`，填入配置：

```ini
# ========== 飞书配置（必需）==========
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxx
FEISHU_CONNECTION_MODE=websocket
FEISHU_DOMAIN=feishu

# ========== OpenCode AI 配置（必需）==========
OPENCODE_API_URL=http://127.0.0.1:4096
OPENCODE_MODEL_ID=glm-4.7
OPENCODE_PROVIDER_ID=venus-coding-ai
OPENCODE_TIMEOUT=600000

# ========== MCP HTTP 服务端口 ==========
MCP_HTTP_PORT=3100

# ========== GitLab 配置（可选）==========
GITLAB_URL=https://gitlab.example.com/api/v4
GITLAB_TOKEN=glpat-xxxxxxxx
GITLAB_PROJECT_ID=123

# ========== 禅道配置（可选）==========
ZENTAO_BASE_URL=https://zentao.example.com/api.php/v1
ZENTAO_ACCOUNT=your-username
ZENTAO_PASSWORD=your-password
ZENTAO_PROJECT_ID=1
```

### 3. 启动

```bash
# 编译
npm run build

# 启动
npm start
```

### 4. 验证

启动成功后看到：

```
========================================
  OpenCode Gateway v3.0
  三层架构: Channels → Gateway → MCP
========================================
[Startup] MCP Servers: zentao, gitlab, workflow
[Gateway] OpenCode SDK initialized
[MCP] Unified HTTP Server started at http://localhost:3100
[Startup] Channels: feishu
[Startup] Available MCP tools: 12

╔════════════════════════════════════════════════════════════════╗
║              OpenCode MCP 配置指南                              ║
╚════════════════════════════════════════════════════════════════╝

将以下配置添加到 OpenCode 配置文件:

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

## 🔌 MCP 工具列表

### 禅道 (zentao.*)

| 工具 | 需要审批 | 说明 |
|------|----------|------|
| `zentao.get_bug` | ❌ | 查询 Bug 详情 |
| `zentao.list_bugs` | ❌ | 查询 Bug 列表 |
| `zentao.create_bug` | ✅ | 创建 Bug（推送审批卡片） |
| `zentao.close_bug` | ✅ | 关闭 Bug（推送审批卡片） |
| `zentao.add_comment` | ❌ | 添加评论 |

### GitLab (gitlab.*)

| 工具 | 需要审批 | 说明 |
|------|----------|------|
| `gitlab.get_branches` | ❌ | 获取分支列表 |
| `gitlab.get_merge_requests` | ❌ | 获取 MR 列表 |
| `gitlab.create_mr` | ✅ | 创建 Merge Request（推送审批卡片） |
| `gitlab.create_branch` | ❌ | 创建分支 |

### 工作流 (workflow.*)

| 工具 | 需要审批 | 说明 |
|------|----------|------|
| `workflow.merge_and_close_bug` | ✅ | 合并 MR 并关闭关联 Bug |
| `workflow.create_mr_for_bug` | ✅ | 为 Bug 创建修复分支和 MR |
| `workflow.get_linked_bugs` | ❌ | 从 MR 描述中提取关联 Bug |

> 💡 **内部工具**：`*_confirm` 和 `cancel` 工具为内部使用，不暴露给 AI，仅通过飞书卡片回调触发。

---

## ✅ 审批流程

敏感操作会先推送飞书卡片，用户确认后才执行：

```
用户: 帮我创建一个 MR，从 feature/xxx 合并到 main
    │
    ▼
AI: 调用 gitlab.create_mr 工具
    │
    ▼
Gateway: 推送飞书卡片
    ┌────────────────────────────────┐
    │ 🔀 创建 MR 确认                 │
    │                                │
    │ 源分支: feature/xxx            │
    │ 目标分支: main                 │
    │                                │
    │ [确认创建]  [取消]              │
    └────────────────────────────────┘
    │
    ├─ 用户点击 [确认创建]
    │       │
    │       ▼
    │   调用 gitlab.create_mr_confirm
    │       │
    │       ▼
    │   GitLab 创建 MR → 返回链接
    │
    └─ 用户点击 [取消]
            │
            ▼
        操作已取消
```

---

## 🔧 OpenCode 集成

### 配置 OpenCode 连接 Gateway

编辑 OpenCode 配置文件：

- **Windows**: `%USERPROFILE%\.config\opencode\opencode.json`
- **macOS/Linux**: `~/.config/opencode/opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "opencode-gateway": {
      "type": "remote",
      "url": "http://localhost:3100/mcp",
      "enabled": true
    }
  }
}
```

### 验证 MCP 工具

```bash
opencode mcp list
```

---

## 📡 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/mcp` | POST | MCP JSON-RPC 入口 |
| `/tools` | GET | 工具列表 |
| `/health` | GET | 健康检查 |
| `/sse` | GET | SSE 流式连接 |

### 示例：调用 MCP 工具

```bash
# 初始化
curl -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

# 获取工具列表
curl -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# 调用工具
curl -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"zentao.get_bug","arguments":{"bugId":1}}}'
```

---

## 🛠️ 扩展指南

### 添加新的 MCP Server

1. 创建 Server 目录：

```bash
mkdir src/mcp-servers/mytool
```

2. 实现 MCP Server：

```typescript
// src/mcp-servers/mytool/index.ts
import { BaseMCPServer } from '../base';
import { createTool } from '../types';
import type { ToolContext } from '../../gateway/types';

export class MyToolMCPServer extends BaseMCPServer {
  readonly name = 'mytool';
  readonly description = '我的工具';

  constructor(config: MyConfig, logger: Logger) {
    super(config, logger);
    this.registerTools([
      createTool({
        name: 'do_something',
        description: '做点什么',
        inputSchema: {
          type: 'object',
          properties: {
            param: { type: 'string', description: '参数' }
          },
          required: ['param']
        },
        execute: async (args, context: ToolContext) => {
          // context.chatId 和 context.userId 已自动注入
          return { success: true, output: 'done' };
        }
      }),
      
      // 需要审批的工具
      createTool({
        name: 'dangerous_action',
        description: '危险操作（需要审批）',
        inputSchema: { /* ... */ },
        requiresApproval: true,
        execute: async (args, context: ToolContext) => {
          // 构建审批卡片...
          await context.sendCard(card);
          return { success: true, requiresApproval: true, output: '已发送审批卡片' };
        }
      }),
      
      // 内部工具（不暴露给 AI）
      createTool({
        name: 'dangerous_action_confirm',
        description: '确认执行（内部）',
        internal: true,  // 不暴露给 AI
        inputSchema: { /* ... */ },
        execute: async (args) => {
          // 执行实际操作
          return { success: true, output: '操作完成' };
        }
      })
    ]);
  }
}

// 导出工厂函数
export function createMyToolMCPServer(config: MyConfig, logger: Logger) {
  return new MyToolMCPServer(config, logger);
}

// 注册到 registry
import { registerMCPServer } from '../index';
registerMCPServer('mytool', createMyToolMCPServer);
```

3. 在 `index.ts` 添加配置解析

### 添加新的 Channel

1. 实现 `ChannelPlugin` 接口：

```typescript
// src/channels/dingtalk/index.ts
import type { ChannelPlugin, StandardMessage } from '../types';

export class DingTalkChannel implements ChannelPlugin {
  readonly id = 'dingtalk';
  readonly type = 'dingtalk';
  readonly name = '钉钉';
  
  readonly outbound = {
    sendText: async (chatId, text) => { /* ... */ },
    sendCard: async (chatId, card) => { /* ... */ },
  };
  
  readonly lifecycle = {
    start: async () => { /* ... */ },
    stop: async () => { /* ... */ },
    healthCheck: async () => ({ healthy: true, message: 'ok' }),
  };
  
  onMessage(handler: (msg: StandardMessage) => Promise<void>) {
    // 注册消息处理器
  }
}

export const createDingTalkChannel: ChannelFactory = (config, logger) => {
  return new DingTalkChannel(config, logger);
};

import { registerChannel } from '../registry';
registerChannel('dingtalk', createDingTalkChannel);
```

---

## 📝 配置详解

### 飞书配置

| 变量 | 说明 | 必需 |
|------|------|------|
| `FEISHU_APP_ID` | 飞书应用 ID | ✅ |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | ✅ |
| `FEISHU_CONNECTION_MODE` | 连接模式 (websocket/webhook) | 默认 websocket |
| `FEISHU_DOMAIN` | 域名 (feishu/lark) | 默认 feishu |

### OpenCode 配置

| 变量 | 说明 | 必需 |
|------|------|------|
| `OPENCODE_API_URL` | OpenCode 服务地址 | ✅ |
| `OPENCODE_MODEL_ID` | 模型 ID | |
| `OPENCODE_PROVIDER_ID` | 提供商 ID | |
| `OPENCODE_TIMEOUT` | 请求超时（毫秒） | 默认 600000 |

### GitLab 配置

| 变量 | 说明 | 必需 |
|------|------|------|
| `GITLAB_URL` | GitLab API 地址（需包含 /api/v4） | ✅ |
| `GITLAB_TOKEN` | 访问令牌（需 api 权限） | ✅ |
| `GITLAB_PROJECT_ID` | 项目 ID | ✅ |

### 禅道配置

| 变量 | 说明 |
|------|------|
| `ZENTAO_BASE_URL` | API 地址（格式：https://xxx/api.php/v1） |
| `ZENTAO_TOKEN` | API Token |
| `ZENTAO_ACCOUNT` | 账号 |
| `ZENTAO_PASSWORD` | 密码 |
| `ZENTAO_PROJECT_ID` | 项目 ID |

> 💡 禅道开源版需 16.5+ 才支持 RESTful API

---

## 🔧 常见问题

### Q: MCP 工具不显示

1. 确认 Gateway 已启动
2. 检查 OpenCode 配置文件路径是否正确
3. 验证 MCP 端点：`curl http://localhost:3100/health`

### Q: 飞书连接失败

1. 检查 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`
2. 确认飞书应用已启用机器人能力
3. 检查 IP 白名单设置

### Q: GitLab 创建 MR 失败

1. 检查 `GITLAB_URL` 格式（需包含 `/api/v4`）
2. Token 需要有 `api` 权限
3. 确认项目 ID 正确

### Q: 禅道连接失败

1. API 地址格式：`https://your-zentao/api.php/v1`
2. 开源版需 16.5+ 才支持 RESTful API
3. 检查账号 API 访问权限

### Q: 卡片发送失败

查看日志中的 `[MCP Tool] sendCard` 相关信息：
- `no channel` → Channel 未注册
- `no chatId` → 上下文丢失

---

## 📜 License

MIT