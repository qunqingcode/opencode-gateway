# OpenCode Gateway 对接指南

> 本文档供研发项目使用，指导 AI 如何与 OpenCode Gateway 对接，实现飞书群聊驱动的开发流程。

## 概述

OpenCode Gateway 是一个连接**飞书**与**AI 开发能力**的网关服务。研发项目只需让 AI 返回特定格式的 JSON，即可触发网关的审批流程，实现：

- **代码修改审批** → 用户确认后创建 MR
- **权限请求** → 用户授权后继续执行
- **问题确认** → 用户选择后继续处理

---

## 网关能力一览

| 能力 | 触发方式 | 效果 |
|------|---------|------|
| **代码修改审批** | 返回 `code_change` JSON | 推送审批卡片，用户点击后创建 MR |
| **权限确认** | AI 发起权限请求 | 推送授权卡片，用户允许后继续 |
| **问题确认** | AI 发起问题请求 | 推送选择卡片，用户回复后继续 |
| **GitLab MR** | 用户点击「创建 MR」 | 自动创建 Merge Request |
| **禅道集成** | 未来扩展 | 创建/更新 Bug、任务 |

---

## 核心对接：代码修改审批

### 触发条件

AI 完成代码修改后，在回复中包含以下 JSON 格式：

```json
{
  "action": "code_change",
  "branchName": "feature-login-fix",
  "summary": "修复登录页面的验证逻辑",
  "files": ["src/auth/login.ts", "src/auth/validator.ts"],
  "changelog": "1. 修复空密码绕过验证的问题\n2. 添加输入长度限制"
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `action` | ✅ | 固定值 `"code_change"` |
| `branchName` | ✅ | 新分支名称 |
| `summary` | ✅ | 修改摘要（一句话） |
| `files` | ✅ | 修改的文件列表 |
| `changelog` | ❌ | 详细变更说明 |
| `docUrl` | ❌ | 相关文档链接 |

### 用户交互流程

```
AI 返回 JSON
    │
    ▼
Gateway 解析 → 推送飞书卡片
    │
    ▼
┌─────────────────────────────┐
│  🛠️ 代码修改完成，请审批      │
│                             │
│  分支: feature-login-fix    │
│  修改文件:                   │
│  - src/auth/login.ts        │
│  - src/auth/validator.ts    │
│                             │
│  [✅ 创建 MR]  [❌ 打回]     │
└─────────────────────────────┘
    │
    ├─ 用户点击「创建 MR」→ GitLab 创建 MR → 返回链接
    │
    └─ 用户点击「打回」→ AI 继续修改或重新提案
```

---

## Skill 配置示例

在项目的 `.opencode/` 目录下创建此 Skill，让 AI 知道如何对接：

```markdown
# .opencode/skills/gateway-protocol.md

## 代码修改完成后的输出规范

当完成代码修改后，**必须**返回以下格式的 JSON：

\`\`\`json
{
  "action": "code_change",
  "branchName": "<分支名>",
  "summary": "<一句话摘要>",
  "files": ["<文件1>", "<文件2>"],
  "changelog": "<可选：详细说明>"
}
\`\`\`

### 要求

1. JSON 必须放在 \`\`\`json 代码块中
2. `branchName` 遵循项目分支命名规范
3. `summary` 简洁明了，适合作为 MR 标题
4. `files` 列出所有修改的文件路径

### 示例

\`\`\`json
{
  "action": "code_change",
  "branchName": "fix/user-auth-validation",
  "summary": "修复用户认证逻辑中的空指针异常",
  "files": ["src/services/auth.service.ts"],
  "changelog": "- 添加 null 检查\n- 优化错误处理"
}
\`\`\`
```

---

## 网关完整能力清单

### 1. 消息通道（飞书）

| 功能 | 说明 |
|------|------|
| 接收消息 | 群聊/私聊消息 |
| 发送文本 | 回复用户 |
| 发送卡片 | 交互式审批卡片 |
| 处理交互 | 按钮点击回调 |

### 2. AI 会话

| 功能 | 说明 |
|------|------|
| Session 管理 | 按 chatId 隔离，1小时过期 |
| 权限请求 | 文件访问、命令执行等需用户确认 |
| 问题请求 | AI 需要用户选择时发起 |
| 代码修改检测 | 从文本解析 `code_change` JSON |

### 3. GitLab 集成

| 功能 | 方法 |
|------|------|
| 获取分支列表 | `getBranches()` |
| 创建分支 | `createBranch(name, ref)` |
| 推送分支 | `pushBranch(name)` |
| 获取 MR 列表 | `getMergeRequests(state)` |
| 创建 MR | `createMergeRequest(source, target, title)` |
| 合并 MR | `mergeMergeRequest(mrId)` |
| 关闭 MR | `closeMergeRequest(mrId)` |

### 4. 禅道集成（可选）

| 功能 | 方法 |
|------|------|
| 获取 Bug 列表 | `getIssues(query)` |
| 获取单个 Bug | `getIssue(id)` |
| 创建 Bug | `createIssue(params)` |
| 更新 Bug | `updateIssue(id, params)` |
| 关闭 Bug | `closeIssue(id)` |
| 添加评论 | `addComment(id, content)` |

---

## 审批卡片类型

### 权限确认卡片

AI 请求敏感操作权限时自动触发：

```
┌─────────────────────────────┐
│  📝 文件编辑请求             │
│                             │
│  路径: src/config.ts        │
│                             │
│  [✅ 允许一次] [✅ 总是允许]  │
│  [❌ 拒绝]                   │
└─────────────────────────────┘
```

### 问题确认卡片

AI 需要用户选择时触发：

```
┌─────────────────────────────┐
│  ❓ 需要您的回复             │
│                             │
│  1. 选择认证方式：          │
│     - JWT                   │
│     - OAuth2                │
│     - Session Cookie        │
│                             │
│  [JWT] [OAuth2] [Session]   │
│  [❌ 取消]                   │
└─────────────────────────────┘
```

---

## 环境变量配置

网关需要以下配置：

```ini
# 飞书（必需）
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx

# OpenCode AI（必需）
OPENCODE_API_URL=http://127.0.0.1:4096
OPENCODE_MODEL_ID=glm-4.7
OPENCODE_PROVIDER_ID=venus-coding-ai

# GitLab（可选，用于 MR 功能）
GITLAB_API_URL=https://gitlab.example.com/api/v4
GITLAB_TOKEN=glpat-xxx
GITLAB_PROJECT_ID=123

# 禅道（可选，用于 Bug 管理）
ZENTAO_BASE_URL=https://zentao.example.com/api.php/v1
ZENTAO_ACCOUNT=xxx
ZENTAO_PASSWORD=xxx
ZENTAO_PROJECT_ID=1
```

---

## 常见场景示例

### 场景 1：修复 Bug

```
用户: @机器人 帮我修复 #123 Bug

AI: 我来分析这个 Bug...
    [修改代码中]
    
    ```json
    {
      "action": "code_change",
      "branchName": "fix/bug-123-login-validation",
      "summary": "修复 #123 登录验证绕过问题",
      "files": ["src/auth/login.ts"],
      "changelog": "添加空值检查，防止绕过验证"
    }
    ```
    
用户: 点击 [创建 MR]

机器人: ✅ MR 创建成功
        https://gitlab.com/.../merge_requests/45
```

### 场景 2：添加新功能

```
用户: @机器人 给用户表添加手机号字段

AI: 需要访问数据库迁移文件，请求权限...
    
    [权限卡片弹出]
    
用户: 点击 [允许]

AI: 已修改以下文件：
    
    ```json
    {
      "action": "code_change",
      "branchName": "feature/user-phone-field",
      "summary": "用户表添加手机号字段",
      "files": [
        "migrations/20240101_add_phone.sql",
        "src/models/user.ts",
        "src/api/user.ts"
      ]
    }
    ```
```

---

## 注意事项

1. **JSON 格式必须正确** - 网关会解析代码块中的 JSON，格式错误会被忽略
2. **分支名规范** - 建议使用 `fix/`、`feature/`、`refactor/` 等前缀
3. **文件路径准确** - 使用相对于项目根目录的路径
4. **摘要简洁** - `summary` 会作为 MR 标题，控制在 50 字符内为宜
5. **Session 隔离** - 不同飞书群的对话相互隔离，1 小时无活动自动过期

---

## 联系与支持

- 项目地址：`opencode-gateway`
- 问题反馈：联系 Gateway 维护团队