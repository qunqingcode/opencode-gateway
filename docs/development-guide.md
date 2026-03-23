# 二次开发指南

本文档介绍如何扩展 OpenCode Gateway，包括：
- 接入新的 IM 平台（钉钉、企业微信等）
- 接入新的 API（GitHub、Jira 等）
- 接入第三方 MCP Server
- 创建自定义 MCP Server

---

## 目录

1. [架构概览](#架构概览)
2. [接入 IM 平台](#接入-im-平台)
3. [接入 API Client](#接入-api-client)
4. [接入第三方 MCP Server](#接入第三方-mcp-server)
5. [创建自定义 MCP Server](#创建自定义-mcp-server)
6. [声明式配置说明](#声明式配置说明)

---

## 架构概览

参考 OpenClaw 的三层设计：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      OpenCode Gateway 架构                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Gateway 层（纯路由）                                                       │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ • Session 管理                                                      │   │
│   │ • 消息路由                                                          │   │
│   │ • MCP 工具调度                                                      │   │
│   │ • 不思考、不推理、不决策                                              │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│            ┌───────────────────────┼───────────────────────┐               │
│            ▼                       ▼                       ▼               │
│   ┌────────────────┐     ┌────────────────┐     ┌────────────────┐        │
│   │ Channel 层     │     │ MCP Server 层  │     │ API Client 层   │        │
│   │                │     │                │     │                │        │
│   │ • 消息格式转换 │     │ • 工具定义     │     │ • API 封装     │        │
│   │ • 路由规则     │     │ • 审批流程     │     │ • 纯函数调用   │        │
│   │ • 不依赖 Client│     │ • 调用 Client  │     │ • 无业务逻辑   │        │
│   └────────────────┘     └────────────────┘     └────────────────┘        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

index.ts (声明式配置)
    │
    ▼
src/app.ts (自动编排)
    │
    ├── channels/     ← IM 平台适配器
    ├── gateway/      ← 核心调度
    ├── mcp-servers/  ← MCP 工具
    │       ├── zentao/
    │       ├── gitlab/
    │       ├── workflow/
    │       └── stdio/
    └── api/          ← API Client（原 providers/）
            ├── feishu/
            ├── gitlab/
            └── zentao/
```

---

## 接入 IM 平台

### 步骤 1：创建 Channel 目录

```bash
mkdir -p src/channels/dingtalk
```

### 步骤 2：实现 ChannelPlugin 接口

```typescript
// src/channels/dingtalk/index.ts
import type { ChannelPlugin, StandardMessage, InteractionEvent, Logger } from '../types';

export interface DingTalkConfig {
  id: string;
  enabled: boolean;
  appKey: string;
  appSecret: string;
}

export class DingTalkChannel implements ChannelPlugin {
  readonly id: string;
  readonly type = 'dingtalk' as const;
  readonly name = '钉钉';

  private config: DingTalkConfig;
  private logger: Logger;
  private messageHandler: ((msg: StandardMessage) => Promise<void>) | null = null;

  constructor(config: DingTalkConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.id = config.id;
  }

  // ========== 消息发送 ==========
  readonly outbound = {
    sendText: async (chatId: string, text: string) => {
      // 调用钉钉 API 发送消息
      await this.callDingTalkAPI('sendMessage', { chatId, msgType: 'text', content: text });
      this.logger.info(`[DingTalk] Sent text to ${chatId}`);
    },

    sendCard: async (chatId: string, card: unknown) => {
      // 调用钉钉 API 发送卡片
      await this.callDingTalkAPI('sendMessage', { chatId, msgType: 'actionCard', content: card });
    },
  };

  // ========== 生命周期 ==========
  readonly lifecycle = {
    start: async () => {
      // 1. 获取 access_token
      // 2. 注册回调地址（webhook 模式）或建立 WebSocket 连接
      // 3. 注册事件订阅
      this.logger.info(`[DingTalk] Channel started: ${this.id}`);
    },

    stop: async () => {
      this.logger.info(`[DingTalk] Channel stopped`);
    },

    healthCheck: async () => {
      // 检查连接状态
      return { healthy: true, message: 'Connected' };
    },
  };

  // ========== 消息接收 ==========
  onMessage(handler: (msg: StandardMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  // 当收到钉钉回调时，转换为标准消息并调用 handler
  private async handleDingTalkCallback(rawMessage: any) {
    if (!this.messageHandler) return;

    const standardMessage: StandardMessage = {
      channelId: this.id,
      channelType: 'dingtalk',
      chatId: rawMessage.conversationId,
      chatType: rawMessage.conversationType === '1' ? 'direct' : 'group',
      userId: rawMessage.senderStaffId,
      content: {
        text: rawMessage.text?.content || '',
      },
      timestamp: Date.now(),
      raw: rawMessage,
    };

    await this.messageHandler(standardMessage);
  }

  // ========== 内部方法 ==========
  private async callDingTalkAPI(method: string, params: any) {
    // 实现钉钉 API 调用
  }
}

// ========== 工厂函数 ==========
export function createDingTalkChannel(config: DingTalkConfig, logger: Logger): ChannelPlugin {
  return new DingTalkChannel(config, logger);
}
```

### 步骤 3：注册 Channel

```typescript
// src/channels/index.ts
import { registerChannel } from './registry';
import { createDingTalkChannel } from './dingtalk';

registerChannel('dingtalk', createDingTalkChannel);
```

### 步骤 4：在配置中启用

```typescript
// index.ts
const app = createApp({
  // ...
  channels: {
    dingtalk: {
      enabled: !!(process.env.DINGTALK_APP_KEY && process.env.DINGTALK_APP_SECRET),
      appKey: process.env.DINGTALK_APP_KEY,
      appSecret: process.env.DINGTALK_APP_SECRET,
    },
  },
});
```

---

## 接入 API Client

API Client 层负责封装第三方 API，供 MCP Server 调用。

### 步骤 1：创建 API Client

```typescript
// src/api/github/index.ts
import { BaseClient } from '../base';
import type { Logger } from '../../types';
import { createHttpClient, HttpClient } from '../../utils/http-client';

export interface GitHubClientConfig {
  token: string;
  owner: string;
  repo: string;
}

export class GitHubClient extends BaseClient {
  readonly name = 'GitHub';
  
  private client: HttpClient;
  private owner: string;
  private repo: string;

  constructor(config: GitHubClientConfig, logger: Logger) {
    super('https://api.github.com', logger);
    this.owner = config.owner;
    this.repo = config.repo;

    this.client = createHttpClient({
      baseUrl: 'https://api.github.com',
      token: config.token,
      tokenLocation: 'bearer',
      timeout: 10000,
    });
  }

  async healthCheck() {
    try {
      await this.client.get(`/repos/${this.owner}/${this.repo}`);
      return { healthy: true, message: 'Connected' };
    } catch (e) {
      return { healthy: false, message: (e as Error).message };
    }
  }

  // ========== API 方法 ==========

  async getPullRequests(state: 'open' | 'closed' | 'all' = 'open') {
    const result = await this.client.get(
      `/repos/${this.owner}/${this.repo}/pulls`,
      { state }
    );
    return result.data;
  }

  async createPullRequest(title: string, head: string, base: string, body?: string) {
    const result = await this.client.post(
      `/repos/${this.owner}/${this.repo}/pulls`,
      { title, head, base, body }
    );
    return result.data;
  }

  async getBranches() {
    const result = await this.client.get(
      `/repos/${this.owner}/${this.repo}/branches`
    );
    return result.data;
  }
}

export function createGitHubClient(config: GitHubClientConfig, logger: Logger) {
  return new GitHubClient(config, logger);
}
```

### 步骤 2：创建对应的 MCP Server

```typescript
// src/mcp-servers/github/index.ts
import { BaseMCPServer } from '../base';
import { createTool } from '../types';
import { GitHubClient, GitHubClientConfig } from '../../api/github';

export class GitHubMCPServer extends BaseMCPServer {
  readonly name = 'github';
  readonly description = 'GitHub 仓库工具';

  private provider: GitHubClient;

  constructor(config: GitHubConfig, logger: Logger) {
    super(config as any, logger);
    this.client = new GitHubClient(config, logger);
    this.registerTools(this.createTools());
  }

  private createTools() {
    return [
      createTool({
        name: 'get_prs',
        description: '获取 Pull Request 列表',
        inputSchema: {
          type: 'object',
          properties: {
            state: { type: 'string', description: '状态 (open/closed/all)' },
          },
        },
        execute: async (args) => {
          const prs = await this.client.getPullRequests(args.state as any);
          return { success: true, output: prs };
        },
      }),

      createTool({
        name: 'create_pr',
        description: '创建 Pull Request',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '标题' },
            head: { type: 'string', description: '源分支' },
            base: { type: 'string', description: '目标分支' },
          },
          required: ['title', 'head', 'base'],
        },
        requiresApproval: true,
        execute: async (args, context) => {
          // 构建审批卡片
          const card = this.buildApprovalCard(args);
          await context.sendCard(card);
          return { success: true, requiresApproval: true, output: '已发送审批卡片' };
        },
      }),
    ];
  }

  private buildApprovalCard(args: any) {
    // 返回飞书卡片结构
    return {
      type: 'template',
      data: {
        template_id: 'xxx',
        template_variable: args,
      },
    };
  }
}

export function createGitHubMCPServer(config: GitHubConfig, logger: Logger) {
  return new GitHubMCPServer(config, logger);
}
```

### 步骤 3：注册 MCP Server

```typescript
// src/mcp-servers/index.ts
import { registerMCPServer } from './registry';
import { createGitHubMCPServer } from './github';

registerMCPServer('github', createGitHubMCPServer);
```

---

## 接入第三方 MCP Server

使用 `StdioMCPServer` 代理，可以集成任何 STDIO 模式的 MCP Server。

### 方式一：在配置中声明

```typescript
// index.ts
const app = createApp({
  // ...
  mcpServers: {
    // 飞书官方 MCP
    lark: {
      enabled: !!(process.env.LARK_MCP_APP_ID),
      type: 'stdio',
      command: () => [
        'npx', '-y', '@larksuiteoapi/lark-mcp', 'mcp',
        '-a', process.env.LARK_MCP_APP_ID!,
        '-s', process.env.LARK_MCP_APP_SECRET!,
      ],
    },

    // GitHub 官方 MCP
    github: {
      enabled: !!(process.env.GITHUB_TOKEN),
      type: 'stdio',
      command: () => ['npx', '-y', '@modelcontextprotocol/server-github'],
    },

    // 文件系统 MCP
    filesystem: {
      enabled: true,
      type: 'stdio',
      command: () => [
        'npx', '-y', '@modelcontextprotocol/server-filesystem',
        '/path/to/folder',
      ],
    },

    // PostgreSQL MCP
    postgres: {
      enabled: !!(process.env.DATABASE_URL),
      type: 'stdio',
      command: () => ['npx', '-y', '@modelcontextprotocol/server-postgres', process.env.DATABASE_URL!],
    },
  },
});
```

### 方式二：使用环境变量

```ini
# .env
GITHUB_TOKEN=ghp_xxx
DATABASE_URL=postgresql://user:pass@host:5432/db
```

### 支持的第三方 MCP Server

| MCP Server | npm 包 | 说明 |
|------------|--------|------|
| GitHub | `@modelcontextprotocol/server-github` | GitHub 仓库操作 |
| PostgreSQL | `@modelcontextprotocol/server-postgres` | 数据库查询 |
| Filesystem | `@modelcontextprotocol/server-filesystem` | 文件系统操作 |
| Puppeteer | `@modelcontextprotocol/server-puppeteer` | 浏览器自动化 |
| Brave Search | `@modelcontextprotocol/server-brave-search` | 网页搜索 |
| Slack | `@modelcontextprotocol/server-slack` | Slack 消息 |
| GitLab | `@modelcontextprotocol/server-gitlab` | GitLab 操作 |
| Google Drive | `@modelcontextprotocol/server-gdrive` | Google Drive |

---

## 创建自定义 MCP Server

### 最小示例

```typescript
// src/mcp-servers/mytool/index.ts
import { BaseMCPServer } from '../base';
import { createTool, ToolDefinition } from '../types';
import type { Logger } from '../../types';

export interface MyToolConfig {
  enabled: boolean;
  apiKey?: string;
}

export class MyToolMCPServer extends BaseMCPServer {
  readonly name = 'mytool';
  readonly description = '我的工具';

  constructor(config: MyToolConfig, logger: Logger) {
    super(config as any, logger);
    this.registerTools(this.createTools());
  }

  private createTools(): ToolDefinition[] {
    return [
      // 查询工具（无需审批）
      createTool({
        name: 'query_data',
        description: '查询数据',
        inputSchema: {
          type: 'object',
          properties: {
            keyword: { type: 'string', description: '关键词' },
          },
        },
        execute: async (args) => {
          const data = await this.doQuery(args.keyword as string);
          return { success: true, output: data };
        },
      }),

      // 写入工具（需要审批）
      createTool({
        name: 'create_item',
        description: '创建项目',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '名称' },
            description: { type: 'string', description: '描述' },
          },
          required: ['name'],
        },
        requiresApproval: true,
        execute: async (args, context) => {
          // 构建审批卡片
          const card = this.buildApprovalCard(args);
          await context.sendCard(card);
          return { success: true, requiresApproval: true, output: '已发送审批请求' };
        },
      }),

      // 确认工具（内部，不暴露给 AI）
      createTool({
        name: 'create_item_confirm',
        description: '确认创建',
        internal: true,  // 关键：不暴露给 AI
        inputSchema: {
          type: 'object',
          properties: {
            requestId: { type: 'string' },
          },
        },
        execute: async (args) => {
          // 执行实际创建
          const item = await this.doCreate(args.requestId as string);
          return { success: true, output: item };
        },
      }),
    ];
  }

  private async doQuery(keyword: string) {
    // 实现查询逻辑
    return [];
  }

  private async doCreate(requestId: string) {
    // 实现创建逻辑
    return {};
  }

  private buildApprovalCard(args: any) {
    return {
      config: { wide_screen_mode: true },
      elements: [
        { tag: 'div', text: { content: `**创建项目确认**`, tag: 'lark_md' } },
        { tag: 'div', text: { content: `名称: ${args.name}`, tag: 'lark_md' } },
        { tag: 'action', actions: [
          { tag: 'button', text: { content: '确认创建' }, type: 'primary', value: { action: 'confirm', ...args } },
          { tag: 'button', text: { content: '取消' }, type: 'default', value: { action: 'cancel' } },
        ] },
      ],
    };
  }
}

export function createMyToolMCPServer(config: MyToolConfig, logger: Logger) {
  return new MyToolMCPServer(config, logger);
}
```

### 注册到系统

```typescript
// src/mcp-servers/index.ts
import { createMyToolMCPServer } from './mytool';

// 添加到 registry
serverRegistry.set('mytool', (config, logger) => 
  createMyToolMCPServer(config, logger)
);
```

### 在配置中启用

```typescript
// index.ts
mcpServers: {
  mytool: {
    enabled: true,
    apiKey: process.env.MYTOOL_API_KEY,
  },
},
```

---

## 声明式配置说明

### 完整配置示例

```typescript
// index.ts
import { createApp } from './src/app';
import { appLogger as logger } from './src/utils/logger';

const app = createApp({
  // 服务端口
  port: 3100,
  
  // OpenCode 配置
  opencode: {
    url: process.env.OPENCODE_API_URL || 'http://127.0.0.1:4096',
    timeout: 600000,
    modelId: process.env.OPENCODE_MODEL_ID,
    providerId: process.env.OPENCODE_PROVIDER_ID,
  },
  
  // Channel 配置（IM 通信）
  channels: {
    feishu: {
      enabled: !!(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET),
      appId: process.env.FEISHU_APP_ID,
      appSecret: process.env.FEISHU_APP_SECRET,
      connectionMode: 'websocket',
      domain: 'feishu',
    },
    // 可以添加更多 channel
    // dingtalk: { ... },
    // wecom: { ... },
  },
  
  // MCP Server 配置
  mcpServers: {
    // 内置 MCP Server
    zentao: {
      enabled: !!(process.env.ZENTAO_BASE_URL),
      baseUrl: process.env.ZENTAO_BASE_URL,
      token: process.env.ZENTAO_TOKEN,
    },
    
    gitlab: {
      enabled: !!(process.env.GITLAB_URL),
      baseUrl: process.env.GITLAB_URL,
      token: process.env.GITLAB_TOKEN,
      projectId: process.env.GITLAB_PROJECT_ID,
    },
    
    // 第三方 MCP Server（Stdio 代理）
    lark: {
      enabled: !!(process.env.LARK_MCP_APP_ID),
      type: 'stdio',
      command: () => ['npx', '-y', '@larksuiteoapi/lark-mcp', 'mcp', '-a', appId, '-s', secret],
    },
  },
}, logger);

app.start();
```

### 配置项说明

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `port` | number | MCP HTTP 服务端口 |
| `opencode.url` | string | OpenCode AI 服务地址 |
| `opencode.modelId` | string? | 模型 ID |
| `channels.<name>.enabled` | boolean | 是否启用 |
| `mcpServers.<name>.enabled` | boolean | 是否启用 |
| `mcpServers.<name>.type` | 'stdio'? | 为 stdio 时使用 StdioMCPServer 代理 |
| `mcpServers.<name>.command` | () => string[] | Stdio MCP 的启动命令 |

---

## 审批流程实现

### 卡片格式

飞书审批卡片示例：

```typescript
const approvalCard = {
  config: { wide_screen_mode: true },
  header: {
    title: { tag: 'plain_text', content: '操作确认' },
    template: 'blue',
  },
  elements: [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**操作**: 创建 MR\n**源分支**: feature/xxx\n**目标分支**: main`,
      },
    },
    {
      tag: 'note',
      elements: [
        { tag: 'plain_text', content: '请在 5 分钟内确认' },
      ],
    },
    {
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '确认' },
          type: 'primary',
          value: { action: 'confirm', tool: 'create_mr', args: {...} },
        },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '取消' },
          type: 'default',
          value: { action: 'cancel' },
        },
      ],
    },
  ],
};
```

### 卡片回调处理

```typescript
// 在 MCP Server 中处理卡片回调
createTool({
  name: 'create_mr_confirm',
  description: '确认创建 MR',
  internal: true,
  inputSchema: { /* ... */ },
  execute: async (args, context) => {
    // args 来自卡片 value
    const { sourceBranch, targetBranch, title } = args;
    
    // 执行实际操作
    const mr = await this.client.createMergeRequest(
      sourceBranch,
      targetBranch,
      title
    );
    
    // 发送结果
    await context.sendText(`MR 已创建: ${mr.web_url}`);
    
    return { success: true, output: mr };
  },
});
```

---

## 调试技巧

### 查看 MCP 工具列表

```bash
curl http://localhost:3100/tools | jq
```

### 测试工具调用

```bash
curl -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "zentao.get_bug",
      "arguments": { "bugId": 1 }
    }
  }'
```

### 查看日志

```bash
tail -f logs/combined.log
```

---

## 常见问题

### Q: 第三方 MCP 启动失败？

1. 确保 `npx` 可用（Node.js 自带）
2. 首次运行会下载 npm 包，需要等待
3. 检查环境变量是否正确

### Q: 卡片发送失败？

1. 检查 Channel 是否启动成功
2. 确认 `context.sendCard` 被正确调用
3. 查看日志中的 `[MCP Tool] sendCard` 信息

### Q: 工具不显示？

1. 检查 `enabled` 配置
2. 确认 MCP Server 已注册
3. 访问 `/tools` 端点验证

---

## 参考资源

- [MCP 官方文档](https://modelcontextprotocol.io)
- [MCP Server 列表](https://github.com/modelcontextprotocol/servers)
- [飞书开放平台](https://open.feishu.cn)
- [OpenCode 文档](https://opencode.ai)