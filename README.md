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
┌─────────────────────────────────────────────────────────────────┐
│                      OpenCode Gateway                           │
│                                                                  │
│   飞书消息 ──► 消息队列 ──► OpenCode AI ──► 审批流程            │
│                                    │                             │
│                                    ▼                             │
│                            ┌─────────────┐                      │
│                            │  推送卡片   │                      │
│                            │ [创建 MR]   │                      │
│                            │ [打回]      │                      │
│                            └─────────────┘                      │
│                                    │                             │
│                            用户点击确认                          │
│                                    │                             │
│                                    ▼                             │
│                            GitLabProvider ──► GitLab API        │
│                            ZentaoProvider ──► 禅道 API          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 📂 项目结构

```
opencode-gateway/
├── index.ts                    # 主入口
├── start.bat                   # Windows 启动脚本
├── start.ps1                   # PowerShell 启动脚本
├── package.json
├── tsconfig.json
├── .env.example                # 环境变量示例
│
├── src/
│   ├── config.ts               # 配置管理
│   │
│   ├── core/                   # 核心引擎
│   │   ├── types.ts            # 类型定义
│   │   ├── provider.ts         # Provider 接口 + 基类
│   │   ├── registry.ts         # Provider 注册中心
│   │   ├── context.ts          # 上下文管理
│   │   ├── queue.ts            # 消息队列
│   │   ├── request-registry.ts # 请求映射
│   │   └── index.ts            # 统一导出
│   │
│   ├── providers/              # 平台适配器
│   │   ├── feishu/             # 飞书 Provider
│   │   │   ├── index.ts        #   主实现
│   │   │   ├── receive.ts      #   消息接收
│   │   │   ├── send.ts         #   消息发送
│   │   │   └── card/           #   卡片模块
│   │   │       ├── index.ts           # 卡片构建
│   │   │       ├── action-handler.ts  # 卡片交互处理
│   │   │       ├── card-builder.ts    # 卡片构建器
│   │   │       └── card-interaction.ts# 卡片交互协议
│   │   │
│   │   ├── opencode/           # OpenCode AI Provider
│   │   │   └── index.ts        #   AI 会话管理
│   │   │
│   │   ├── gitlab/             # GitLab Provider
│   │   │   └── index.ts        #   MR 创建
│   │   │
│   │   └── zentao/             # 禅道 Provider
│   │       └── index.ts        #   Bug/任务管理
│   │
│   ├── orchestrator/           # 流程编排
│   │   └── index.ts            # 消息处理 + 卡片交互
│   │
│   └── utils/                  # 工具函数
│       ├── logger.ts           # 日志系统
│       ├── file.ts             # 文件处理
│       ├── http-client.ts      # HTTP 客户端
│       └── index.ts            # 统一导出
│
├── .opencode/
│   └── tools/
│       └── code_change.ts      # AI 代码修改确认工具
│
└── logs/                       # 日志目录（自动生成）
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

# 或 Windows 一键启动
.\start.bat
```

### 4. 验证

启动成功后看到：

```
========================================
  OpenCode Gateway v2.6
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

### 审批流程

```
1. 用户发消息
       │
       ▼
2. AI 分析并修改代码
       │
       ▼
3. 返回 Code Change Request
       │
       ▼
4. Gateway 推送审批卡片
       │
       ▼
5. 用户点击 [创建 MR] 或 [打回]
       │
       ├─ [创建 MR] → GitLabProvider.createMR() → 返回 MR 链接
       │
       └─ [打回] → 返回打回提示
```

## 🔧 核心概念

### Provider

Provider 是 Gateway 内部的平台适配器，封装不同平台的 API：

| Provider | 职责 | 触发时机 |
|----------|------|----------|
| **FeishuProvider** | 消息收发、卡片推送 | 接收用户消息、推送审批卡片 |
| **OpenCodeProvider** | AI 会话管理 | 处理消息时调用 AI |
| **GitLabProvider** | 创建 Merge Request | 用户点击 [创建 MR] |
| **ZentaoProvider** | 创建 Bug/任务 | 未来扩展 |

### 消息队列

```
┌─────────────────────────────────────────────────────────────────┐
│                         消息队列                                 │
│                                                                  │
│   特性：                                                         │
│   - 按 chatId 隔离（群聊/私聊独立）                             │
│   - 防乱序（同一会话串行处理）                                   │
│   - 防刷屏（队列最大 100 条）                                    │
│   - 自动清理（空队列删除）                                       │
│                                                                  │
│   src/core/queue.ts                                              │
└─────────────────────────────────────────────────────────────────┘
```

### Session 管理

```
┌─────────────────────────────────────────────────────────────────┐
│                        Session 管理                              │
│                                                                  │
│   特性：                                                         │
│   - 按 chatId 隔离 AI 会话                                      │
│   - 自动过期（1 小时无活动）                                     │
│   - 上下文保持（同一会话共享）                                   │
│                                                                  │
│   src/providers/opencode/index.ts                                │
└─────────────────────────────────────────────────────────────────┘
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

Session 默认 1 小时过期，可在 `src/providers/openco
