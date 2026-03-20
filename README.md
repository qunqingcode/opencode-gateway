# OpenCode Gateway

> **飞书 AI 智能体网关** — 在飞书群里聊天，让 AI 帮你改代码、提 MR、管 Bug

## 🎯 这是什么？

一个连接**飞书**和**OpenCode AI**的网关服务。

**核心功能**：
- 在飞书群里发消息，AI 帮你修改代码
- 代码修改后推送审批卡片，你确认后才执行
- 支持 GitLab Merge Request 创建
- 支持禅道 Bug/任务管理

## 📐 架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            OpenCode Gateway                                  │
│                                                                              │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐     │
│  │  Runtime    │──►│  Commands   │──►│   Adapter   │──►│  External   │     │
│  │  (运行时)    │   │  (指令层)   │   │  (适配器)   │   │  (外部系统)  │     │
│  └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘     │
│         │                 │                 │                               │
│         ▼                 ▼                 ▼                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        Core (基础设施层)                              │   │
│  │  类型定义 │ Provider 接口 │ 注册中心 │ 消息队列 │ 全局上下文          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 分层职责

| 层级 | 目录 | 职责 | 依赖方向 |
|------|------|------|----------|
| **Runtime** | `src/runtime/` | 应用启动、消息调度、流程编排 | 依赖 Commands |
| **Commands** | `src/commands/` | 业务指令（权限、问题、代码修改） | 依赖 Core |
| **Providers** | `src/providers/` | 平台适配（飞书、GitLab、OpenCode、禅道） | 依赖 Core |
| **Core** | `src/core/` | 基础设施（类型、队列、注册中心） | 无依赖（底层） |

### 数据流

```
用户消息
    │
    ▼
┌─────────────┐
│   Runtime   │ 消息队列、调度
└─────────────┘
    │
    ▼
┌─────────────┐
│   Adapter   │ OpenCode AI 处理
└─────────────┘
    │
    ▼
┌─────────────┐
│  Commands   │ 解析指令、构建卡片
└─────────────┘
    │
    ▼
┌─────────────┐
│   Adapter   │ 飞书推送卡片
└─────────────┘
    │
    ▼
用户交互
    │
    ▼
┌─────────────┐
│  Commands   │ 处理交互（创建 MR 等）
└─────────────┘
    │
    ▼
┌─────────────┐
│   Adapter   │ GitLab 创建 MR
└─────────────┘
```

## 📂 项目结构

```
opencode-gateway/
├── index.ts                    # 主入口
├── package.json
├── tsconfig.json
├── .env.example                # 环境变量示例
│
├── src/
│   ├── config.ts               # 配置管理
│   │
│   ├── core/                   # 基础设施层
│   │   ├── types.ts            #   类型定义
│   │   ├── provider.ts         #   Provider 接口 + 基类
│   │   ├── registry.ts         #   Provider 注册中心
│   │   ├── context.ts          #   全局上下文
│   │   ├── queue.ts            #   消息队列
│   │   └── request-registry.ts #   请求映射
│   │
│   ├── providers/              # 适配器层
│   │   ├── feishu/             #   飞书适配器
│   │   │   ├── index.ts        #     主实现
│   │   │   ├── receive.ts      #     消息接收
│   │   │   ├── send.ts         #     消息发送
│   │   │   └── card/           #     卡片模块
│   │   │       ├── index.ts              # 卡片模板
│   │   │       ├── card-builder.ts       # 卡片构建器
│   │   │       ├── card-builder-impl.ts  # 飞书卡片实现
│   │   │       └── card-interaction.ts   # 卡片交互协议
│   │   │
│   │   ├── opencode/           #   OpenCode AI 适配器
│   │   │   └── index.ts        #     AI 会话管理
│   │   │
│   │   ├── gitlab/             #   GitLab 适配器
│   │   │   └── index.ts        #     MR 创建
│   │   │
│   │   └── zentao/             #   禅道适配器
│   │       └── index.ts        #     Bug/任务管理
│   │
│   ├── commands/               # 指令层
│   │   ├── types.ts            #   指令类型定义
│   │   ├── pipeline.ts         #   指令流水线
│   │   ├── code-change/        #   代码修改指令
│   │   │   └── index.ts
│   │   ├── permission/         #   权限指令
│   │   │   └── index.ts
│   │   └── question/           #   问题指令
│   │       └── index.ts
│   │
│   ├── runtime/                # 运行时层
│   │   └── index.ts            #   应用启动和调度
│   │
│   ├── utils/                 # 工具模块
│   │   ├── logger.ts           #   日志系统
│   │   ├── file.ts             #   文件处理
│   │   └── http-client.ts      #   HTTP 客户端
│   │
│   └── skills/                 # Skill 文档
│       └── gateway-integration.md  # 研发项目对接指南
│
└── logs/                       # 日志目录（自动生成）
```

## 🏗️ 核心设计

### 适配器模式（Adapter Pattern）

适配器层封装外部平台 API，提供统一接口：

```typescript
// core/provider.ts
interface IMessengerProvider {
  sendText(chatId: string, text: string): Promise<void>;
  sendCard?(chatId: string, card: unknown): Promise<void>;
  onMessage(handler: MessageHandler): void;
}

interface IRepositoryProvider {
  createMergeRequest(source: string, target: string, title: string): Promise<MR>;
}
```

### 指令层模式（Command Pattern）

指令层定义业务指令的完整生命周期：

```typescript
// commands/types.ts
interface CommandHandler<TPayload> {
  readonly type: CommandType;
  
  // 1. 解析：从 AI 响应中提取指令
  parse(text: string): Command<TPayload> | null;
  
  // 2. 卡片：构建审批卡片
  buildCard(command: Command, context: CommandContext): Promise<unknown>;
  
  // 3. 交互：处理用户操作
  handleInteraction(action: string, envelope: InteractionEnvelope): Promise<InteractionResult>;
}
```

### 卡片构建抽象（CardBuilder）

支持多平台卡片格式：

```typescript
// commands/types.ts
interface CardBuilder {
  buildPermissionCard(payload: PermissionPayload, context: CardContext): Promise<unknown>;
  buildQuestionCard(payload: QuestionPayload, context: CardContext): Promise<unknown>;
  buildCodeChangeCard(payload: CodeChangePayload, context: CardContext): Promise<unknown>;
  buildStatusCard(payload: StatusPayload): Promise<unknown>;
}
```

### 依赖注入（Dependency Injection）

运行时层负责组装所有依赖：

```typescript
// runtime/index.ts
function setupRuntime(messengerProvider, gitlabProvider) {
  // 1. 创建卡片构建器
  const cardBuilder = getFeishuCardBuilder();
  
  // 2. 构建服务依赖
  const services: CommandServices = {
    opencode: { replyPermission, replyQuestion, ... },
    registry: { getChatId },
    repository: gitlabProvider ? { createMergeRequest } : undefined,
  };
  
  // 3. 初始化指令层
  setupCommands(cardBuilder, services);
}
```

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

编辑 `.env`，填入你的配置：

```ini
# ========== 飞书配置（必需）==========
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxx

# ========== OpenCode AI 配置（必需）==========
OPENCODE_API_URL=http://127.0.0.1:4096
OPENCODE_MODEL_ID=glm-4.7
OPENCODE_PROVIDER_ID=venus-coding-ai

# ========== GitLab 配置（可选）==========
GITLAB_API_URL=https://gitlab.example.com/api/v4
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
  OpenCode Gateway v2.7
  飞书 AI 智能体网关
========================================
  Providers: 4
  OpenCode: http://127.0.0.1:4096
========================================
  [OK] feishu: Client initialized
  [OK] gitlab: Connection successful
  [OK] zentao: Connection successful
  [OK] opencode: SDK initialized
```

## 📖 使用指南

### 基本用法

在飞书群里：

```
你: @机器人 帮我修复登录页面的 Bug

机器人: 我来分析一下...
        
        [权限请求] 需要访问 /src/auth/
        [允许] [拒绝]

你: 点击 [允许]

机器人: 已修改以下文件：
        - src/auth/login.ts
        
        [✅ 创建 MR]  [❌ 打回]

你: 点击 [创建 MR]

机器人: ✅ MR 创建成功
        https://gitlab.com/.../merge_requests/45
```

### 研发项目对接

研发项目只需让 AI 返回特定格式的 JSON，即可触发网关审批流程：

```json
{
  "action": "code_change",
  "branchName": "feature-xxx",
  "summary": "修改摘要",
  "files": ["file1.ts", "file2.ts"]
}
```

完整的对接指南请参考：**[src/skills/gateway-integration.md](src/skills/gateway-integration.md)**

该文档可复制到研发项目的 `.opencode/skills/` 目录，指导 AI 如何与网关对接。

## 🔧 扩展指南

### 新增适配器

```typescript
// src/providers/dingtalk/index.ts
import { IMessengerProvider } from '../../core';

export class DingTalkAdapter implements IMessengerProvider {
  async sendText(chatId: string, text: string) { /* ... */ }
  async sendCard(chatId: string, card: unknown) { /* ... */ }
  onMessage(handler: MessageHandler) { /* ... */ }
}
```

### 新增指令

```typescript
// src/commands/deploy/index.ts
import { CommandHandler, Command, CommandContext } from '../types';

export const deployHandler: CommandHandler<DeployPayload> = {
  type: 'deploy',
  
  parse(text) {
    // 解析部署指令
  },
  
  async buildCard(command, context) {
    return context.cardBuilder.buildDeployCard(command.payload);
  },
  
  async handleInteraction(action, envelope, context) {
    // 处理部署确认
  },
};

// 注册到 Pipeline
getCommandPipeline().register(deployHandler);
```

### 新增卡片平台

```typescript
// src/providers/dingtalk/card-builder.ts
import { CardBuilder } from '../../../commands/types';

export class DingTalkCardBuilder implements CardBuilder {
  async buildPermissionCard(payload, context) { /* 钉钉卡片格式 */ }
  async buildQuestionCard(payload, context) { /* 钉钉卡片格式 */ }
  async buildCodeChangeCard(payload, context) { /* 钉钉卡片格式 */ }
  async buildStatusCard(payload) { /* 钉钉卡片格式 */ }
}

// 在运行时切换
const cardBuilder = new DingTalkCardBuilder();
setupCommands(cardBuilder, services);
```

## 📝 配置详解

### 飞书配置

| 变量 | 说明 | 必需 | 默认值 |
|------|------|------|--------|
| `FEISHU_APP_ID` | 飞书应用 ID | ✅ | - |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | ✅ | - |
| `FEISHU_CONNECTION_MODE` | 连接模式 | | `websocket` |
| `FEISHU_DOMAIN` | 域名（feishu/lark） | | `feishu` |

### OpenCode 配置

| 变量 | 说明 | 必需 | 默认值 |
|------|------|------|--------|
| `OPENCODE_API_URL` | OpenCode 服务地址 | ✅ | - |
| `OPENCODE_MODEL_ID` | 模型 ID | | - |
| `OPENCODE_PROVIDER_ID` | 提供商 ID | | - |
| `OPENCODE_TIMEOUT` | 请求超时（毫秒） | | `600000` |

### GitLab 配置

| 变量 | 说明 | 必需 |
|------|------|------|
| `GITLAB_API_URL` | GitLab API 地址 | ✅ |
| `GITLAB_TOKEN` | 访问令牌（需 `api` 权限） | ✅ |
| `GITLAB_PROJECT_ID` | 项目 ID | ✅ |

### 禅道配置

| 变量 | 说明 |
|------|------|
| `ZENTAO_BASE_URL` | 禅道 API 地址（如 `https://zentao/api.php/v1`） |
| `ZENTAO_TOKEN` | API Token（二选一） |
| `ZENTAO_ACCOUNT` + `ZENTAO_PASSWORD` | 账号密码（二选一） |
| `ZENTAO_PROJECT_ID` | 项目 ID |

## 🔧 常见问题

### Q: 飞书连接失败

1. 检查 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 是否正确
2. 确认飞书应用已启用机器人能力
3. 检查 IP 白名单设置

### Q: GitLab 创建 MR 失败

1. 检查 `GITLAB_API_URL` 是否正确（注意 `/api/v4` 路径）
2. Token 是否有 `api` 权限
3. 项目 ID 是否正确

### Q: 禅道连接失败

1. 确认 API 地址格式：`https://your-zentao/api.php/v1`
2. 开源版需要 16.5+ 才支持 RESTful API
3. 检查账号是否有 API 访问权限

### Q: Session 过期

Session 默认 1 小时过期，可在 `src/adapters/opencode/index.ts` 中修改 `SESSION_TTL_MS`。

## 📜 License

MIT