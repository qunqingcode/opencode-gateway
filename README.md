# OpenCode Gateway v2.5

> 基于 [OpenClaw](https://github.com/openclaw/openclaw) 架构设计思想演进的 **AI 智能体网关 (Agent Gateway) 与编排器**。

本项目是一个连接人类通讯工具（飞书、GitLab、禅道等）与底层大模型/AI Agent 的中心枢纽。它不仅负责消息的收发，还承担了**多租户会话隔离、工具调用 (Function Calling) 解析、并发队列控制、以及人机审批流 (Human-in-the-loop) 编排**的核心职责。

## 🚀 核心特性

- **插件化架构**：支持飞书、GitLab、禅道等多平台，基于 `IProvider` 接口设计，随时可横向扩展接入钉钉、企业微信、Slack、Jira 等。
- **工业级可靠性**：
  - **多租户 Session 隔离**：基于 `chatId` 的上下文隔离，群聊/私聊互不串线。
  - **防乱序并发队列**：内置带防刷屏保护和智能锁释放的消息队列，保障高并发下的稳定交互。
  - **Session 过期清理**：自动清理 1 小时未活动的会话，防止内存泄漏。
  - **持久化日志追踪**：引入 `winston` 提供按天轮转的结构化文件日志 (`logs/`)。
- **现代化的 AI Tool-Use 解析**：抛弃脆弱的纯文本正则匹配，通过 System Prompt 强制注入，实现了高鲁棒性的标准 JSON Schema 解析。
- **人机协同审批流 (HITL)**：完美融合飞书交互式卡片，当 AI 试图提 MR 或执行高危命令时，将阻断执行并推送审批卡片，人类点击后自动恢复 AI 的后台处理。

## 📂 项目结构

```
opencode-gateway/
├── index.ts                    # 主入口：启动服务 + Provider 注册
├── start.bat / start.ps1       # 一键启动脚本
├── tsconfig.json
├── package.json
├── .env.example
│
└── src/
    ├── config.ts               # 环境配置管理
    │
    ├── core/                   # 核心引擎层
    │   ├── types.ts            # 类型定义
    │   ├── provider.ts         # Provider 接口 + 基类
    │   ├── registry.ts         # Provider 注册中心 + 生命周期管理
    │   ├── context.ts          # Provider 引用管理
    │   ├── request-registry.ts # 请求映射（卡片交互上下文）
    │   ├── queue.ts            # 消息队列引擎
    │   └── index.ts            # 统一导出
    │
    ├── providers/              # 平台适配器
    │   ├── feishu/             # 飞书
    │   │   ├── index.ts        # Provider 实现
    │   │   ├── receive.ts      # 消息接收
    │   │   ├── send.ts         # 消息发送
    │   │   └── card/           # 卡片交互
    │   │       ├── action-handler.ts
    │   │       ├── card-builder.ts
    │   │       └── card-interaction.ts
    │   ├── gitlab/             # GitLab
    │   ├── zentao/             # 禅道
    │   └── opencode/           # OpenCode AI
    │
    ├── orchestrator/           # 流程编排
    │   └── index.ts            # 消息处理 + 卡片交互编排
    │
    └── utils/
        ├── logger.ts           # Winston 日志系统
        └── file.ts             # 文件路径处理
```

## 🏗️ 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                         index.ts (启动入口)                      │
│   - Provider 注册                                               │
│   - 初始化 ProviderManager                                      │
│   - 调用 setupOrchestrator()                                    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      orchestrator (流程编排)                     │
│   - createMessageHandler(): 用户消息 → AI → 回复/卡片            │
│   - createCardHandler(): 卡片交互 → 回调 → 继续 AI               │
└─────────────────────────────────────────────────────────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│  core/queue.ts  │   │ providers/opencode│   │  providers/feishu│
│   消息队列引擎   │   │    AI SDK 封装    │   │    飞书适配器    │
└─────────────────┘   └─────────────────┘   └─────────────────┘
```

### 核心模块职责

| 模块 | 职责 |
|------|------|
| `core/types.ts` | 所有模块共用的类型定义 |
| `core/provider.ts` | Provider 接口定义 + BaseProvider 基类 |
| `core/registry.ts` | Provider 注册、创建、生命周期管理 |
| `core/context.ts` | 跨模块的 Provider 引用管理 |
| `core/request-registry.ts` | 卡片交互时的请求上下文映射 |
| `core/queue.ts` | 按 chatId 隔离的消息队列 |
| `orchestrator/` | 业务流程编排（消息处理、卡片交互） |
| `providers/opencode/` | OpenCode AI SDK 封装 |
| `providers/feishu/` | 飞书消息收发 + 卡片交互 |
| `providers/gitlab/` | GitLab MR 创建 |
| `providers/zentao/` | 禅道 Bug/Task 管理 |

## ⚡ 快速开始

### 1. 配置环境变量

将 `.env.example` 复制为 `.env`，填入真实配置：

```ini
# 飞书应用凭证
FEISHU_APP_ID=cli_a92xxxxx
FEISHU_APP_SECRET=qzaUgxxxxx

# OpenCode 服务地址
OPENCODE_API_URL=http://127.0.0.1:4096

# OpenCode 模型配置
OPENCODE_MODEL_ID=glm-4.7
OPENCODE_PROVIDER_ID=venus-coding-ai

# GitLab 配置（可选，用于自动创建 MR）
GITLAB_URL=https://gitlab.example.com/api/v4
GITLAB_TOKEN=glpat-xxxxx
GITLAB_PROJECT_ID=123
```

### 2. 启动服务

**Windows:**
```powershell
.\start.bat
```

**macOS / Linux:**
```bash
npm install
npm run build
npm start
```

## 🛠️ 核心工作流

### 自动化代码修改流程

```
用户消息: "帮我修复这个 Bug"
        │
        ▼
┌───────────────────┐
│   飞书接收消息     │
│   → enqueueMessage│
└───────────────────┘
        │
        ▼
┌───────────────────┐
│   消息队列处理     │
│   → createMessageHandler
└───────────────────┘
        │
        ▼
┌───────────────────┐
│   调用 OpenCode AI │
│   → chat(prompt)  │
└───────────────────┘
        │
        ├─ 权限请求 → 推送审批卡片
        ├─ 问题请求 → 推送选择卡片
        └─ 代码修改 → 推送 MR 确认卡片
        │
        ▼
┌───────────────────┐
│   用户点击卡片     │
│   → createCardHandler
└───────────────────┘
        │
        ▼
┌───────────────────┐
│   执行操作         │
│   → 创建 MR / 回复 │
└───────────────────┘
```

### 人机审批流 (HITL)

当 AI 试图执行敏感操作时：

1. **阻断**：AI 触发 `PermissionRequest`，进入等待状态
2. **确认**：Gateway 推送权限确认卡片到飞书
3. **恢复**：用户点击"允许"，Gateway 调用 `continueAfterReply()` 恢复 AI 处理

## 📚 扩展开发指南

### 新增 IM 平台（如企业微信）

1. 在 `src/providers/` 下新建目录 `wecom/`

2. 实现 `IMessengerProvider` 接口：

```typescript
// src/providers/wecom/index.ts
import { BaseProvider, IMessengerProvider, MessageEvent } from '../../core';

export class WeComProvider extends BaseProvider implements IMessengerProvider {
  readonly type = 'messenger';
  readonly capabilities = ['messaging', 'notification'];

  async sendText(chatId: string, text: string) {
    // 实现企微消息发送
  }

  onMessage(handler: (event: MessageEvent) => Promise<void>) {
    // 注册消息处理器
  }
}
```

3. 在 `index.ts` 注册：

```typescript
import { registerProvider } from './src/core';
import { createWeComProvider, WeComConfig } from './src/providers/wecom';

registerProvider(
  'wecom',
  (config, log) => createWeComProvider(config as WeComConfig, log),
  'messenger',
  ['messaging', 'notification']
);
```

### 新增代码仓库平台（如 GitHub）

实现 `IRepositoryProvider` 接口，提供 `createMergeRequest()` 等方法。

### 自定义流程编排

修改 `src/orchestrator/index.ts` 中的 `createMessageHandler()` 自定义消息处理逻辑。

## 📝 日志与排错

- 控制台输出带时间戳和色彩的直观日志
- 日志自动持久化到 `logs/` 目录
- `application-*.log` 全量日志，`error-*.log` 错误日志
- 按天自动切割

## 🔧 常见问题

### Q: GitLab 连接失败 "self-signed certificate"

修改 `src/providers/gitlab/index.ts`，添加 `rejectUnauthorized: false`。

### Q: Token 权限不足 403

确保 GitLab Token 有 `api` 权限，而非仅 `read_api`。

### Q: Session 过期

Session 默认 1 小时过期，可在 `src/providers/opencode/index.ts` 修改 `SESSION_TTL_MS`。

## 参考

- 架构灵感来源: [OpenClaw](https://github.com/openclaw/openclaw)
- [Feishu Open Platform](https://open.feishu.cn/document/)
- [OpenCode SDK](https://www.npmjs.com/package/@opencode-ai/sdk)

## License

MIT