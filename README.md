# OpenCode Gateway (AI Agent Orchestrator)

> 基于 [OpenClaw](https://github.com/openclaw/openclaw) 架构设计思想演进的 **AI 智能体网关 (Agent Gateway) 与编排器**。

本项目是一个连接人类通讯工具（飞书、GitLab、禅道等）与底层大模型/AI Agent 的中心枢纽。它不仅负责消息的收发，还承担了**多租户会话隔离、工具调用 (Function Calling) 解析、并发队列控制、以及人机审批流 (Human-in-the-loop) 编排**的核心职责。

## 🚀 核心特性

- **多通道插件化架构**：支持飞书、GitLab 等多平台，基于 `IMessengerProvider` 接口设计，随时可横向扩展接入钉钉、企业微信或 Slack。
- **工业级可靠性**：
  - **多租户 Session 隔离**：基于 `chatId` 的上下文隔离，群聊/私聊互不串线。
  - **防乱序并发队列**：内置带防刷屏保护和智能锁释放的消息队列，保障高并发下的稳定交互。
  - **持久化日志追踪**：引入 `winston` 提供按天轮转的结构化文件日志 (`logs/`)。
- **现代化的 AI Tool-Use 解析**：抛弃脆弱的纯文本正则匹配，通过 System Prompt 强制注入，实现了高鲁棒性的标准 JSON Schema 解析。
- **人机协同审批流 (HITL)**：完美融合飞书交互式卡片，当 AI 试图提 MR 或执行高危命令时，将阻断执行并推送审批卡片，人类点击后自动恢复 AI 的后台处理。

## 📂 项目结构

```
opencode-gateway/
├── index.ts              # 网关主入口 (服务注册与启动)
├── start.bat / start.ps1 # 一键安装、编译与启动脚本
├── tsconfig.json         # TypeScript 配置
├── package.json          # 依赖配置
├── .env.example          # 环境变量示例
└── src/
    ├── queue.ts          # 消息防乱序并发队列引擎
    ├── opencode.ts       # AI 模型与会话隔离核心逻辑 (包含 JSON 解析)
    ├── config.ts         # 环境配置管理
    ├── core/             # 核心引擎层
    │   ├── context.ts    # 全局上下文依赖注入
    │   ├── provider.ts   # 通道提供者基础接口
    │   └── registry.ts   # 提供者注册中心
    ├── providers/        # 平台适配器实现
    │   ├── feishu/       # 飞书网关实现 (包含卡片构建、文件上传拦截)
    │   └── gitlab/       # GitLab 实现
    └── utils/
        └── logger.ts     # 工业级 Winston 日志系统
```

## ⚡ 快速开始 (一键启动)

我们提供了对小白极其友好的启动脚本，它可以帮你自动检查依赖、安装 npm 包、编译 TypeScript 并启动服务。

### 1. 配置环境变量

首先，将项目根目录下的 `.env.example` 文件复制一份并重命名为 `.env`。
然后填入你的真实配置：

```ini
# 飞书应用凭证
FEISHU_APP_ID=cli_a92xxxxx
FEISHU_APP_SECRET=qzaUgxxxxx

# OpenCode 服务地址
OPENCODE_API_URL=http://127.0.0.1:4096

# OpenCode 模型配置
OPENCODE_MODEL_ID=glm-4.7
OPENCODE_PROVIDER_ID=venus-coding-ai
```

### 2. 一键启动

**对于 Windows 用户 (CMD / PowerShell):**

双击运行 `start.bat`，或者在终端输入：

```powershell
# 运行默认模式（自动安装 -> 编译 -> 启动）
.\start.bat

# 或者使用 PowerShell 脚本
.\start.ps1
```

> **提示**：启动脚本支持多个参数，例如 `.\start.bat dev` 可启动 ts-node 热重载开发模式；`.\start.bat build` 用于仅编译。

**对于 macOS / Linux 用户:**

```bash
npm install
npm run build
npm start
```

## 🛠 核心工作流演示

### 1. 自动化 Bug 修复流 (代码自动编写与 MR 提交流)

1. **触发**：用户在飞书群里 @机器人 "修复这个空指针 Bug..."
2. **路由与隔离**：Gateway 将消息放入该 `chatId` 独占的队列中，提取历史 Session 上下文发送给 AI。
3. **AI 推理与 Tool Use**：AI 分析代码后，返回标准的 JSON `code_change` 请求指令。
4. **人工审批**：Gateway 拦截该指令，向飞书群推送一张精美的 **审批卡片** (包含修改摘要、影响文件等)。
5. **执行与闭环**：用户点击 **"✅ 创建 MR"** 按钮，Gateway 调用 GitLab API 自动拉取分支并创建 Merge Request。

### 2. 高危操作拦截流

当 AI 试图执行类似 `rm -rf` 等敏感命令时：
1. **阻断**：AI 触发 `PermissionRequest`，进入等待状态。
2. **确认**：Gateway 向用户推送 **权限确认卡片**。
3. **恢复**：用户点击 "允许" 后，Gateway 触发恢复轮询，AI 恢复后台执行并返回最终结果。

## 📚 扩展开发指南

如果需要接入新的 IM 平台（如企业微信）：
1. 在 `src/providers/` 下新建目录（如 `wecom/`）。
2. 实现 `IMessengerProvider` 接口，对接企微的消息收发 SDK。
3. 在 `index.ts` 的 `providerConfig.id` 分支中注册你的 Provider，并将其 `onMessage` 挂载到 `enqueueMessage` 上即可。

## 📝 日志与排错

项目集成了 `winston` 工业级日志系统：
- 控制台会输出带有时间戳和色彩的直观日志。
- 所有的日志会被自动持久化到项目根目录的 `logs/` 文件夹中。
- `application-*.log` 包含全量日志，`error-*.log` 专门收集异常报错，按天自动切割。

## 参考

- 架构灵感来源: [OpenClaw](https://github.com/openclaw/openclaw)
- [Feishu Open Platform](https://open.feishu.cn/document/)

## License

MIT