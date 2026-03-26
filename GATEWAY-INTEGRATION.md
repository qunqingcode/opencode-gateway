# OpenCode Gateway 对接指南

> 本文档供 AI 接入 OpenCode Gateway 时参考，包含所有可用的 MCP 工具、工作流和最佳实践。

---

## 一、Gateway 概述

OpenCode Gateway 是一个连接飞书与 OpenCode AI 的网关服务，提供：

- **飞书消息收发**：在飞书群聊中与 AI 交互
- **审批卡片**：敏感操作推送审批卡片，用户确认后执行
- **MCP 工具集成**：GitLab、禅道、飞书文档、消息发送等

### 启动 Gateway

```bash
# 终端1：启动 OpenCode Server
opencode serve --port 4096

# 终端2：启动 Gateway
cd opencode-gateway
npm run dev
```

### MCP 端点

```
http://localhost:3100/mcp
```

---

## 二、可用 MCP 工具

> **工具命名格式**：`opencode-gateway_{server}_{tool}`
> 例如：`opencode-gateway_zentao_get_bug`

### 2.1 禅道工具 (zentao.*)

| 工具 | 说明 | 需要审批 |
|------|------|:--------:|
| `opencode-gateway_zentao_get_bug` | 获取 Bug 详情 | ❌ |
| `opencode-gateway_zentao_list_bugs` | 查询 Bug 列表 | ❌ |
| `opencode-gateway_zentao_create_bug` | 创建 Bug | ✅ |
| `opencode-gateway_zentao_close_bug` | 关闭 Bug | ✅ |
| `opencode-gateway_zentao_add_comment` | 添加评论 | ❌ |

**调用示例**：

```json
{
  "name": "opencode-gateway_zentao_get_bug",
  "arguments": {
    "bugId": 123
  }
}
```

**查询 Bug 列表**：

```json
{
  "name": "opencode-gateway_zentao_list_bugs",
  "arguments": {
    "status": "active",
    "assignee": "zhangsan",
    "limit": 10
  }
}
```

### 2.2 GitLab 工具 (gitlab.*)

| 工具 | 说明 | 需要审批 |
|------|------|:--------:|
| `opencode-gateway_gitlab_get_branches` | 获取分支列表 | ❌ |
| `opencode-gateway_gitlab_get_merge_requests` | 获取 MR 列表 | ❌ |
| `opencode-gateway_gitlab_create_mr` | 创建 Merge Request | ✅ |
| `opencode-gateway_gitlab_create_branch` | 创建分支 | ❌ |

**调用示例**：

```json
{
  "name": "opencode-gateway_gitlab_create_mr",
  "arguments": {
    "sourceBranch": "fix/login-bug",
    "targetBranch": "develop",
    "title": "修复登录页面白屏问题",
    "changelogUrl": "https://feishu.cn/docx/xxx"
  }
}
```

### 2.3 工作流工具 (workflow.*)

| 工具 | 说明 | 需要审批 |
|------|------|:--------:|
| `opencode-gateway_workflow_get_linked_bugs` | 从 MR 描述提取关联 Bug | ❌ |
| `opencode-gateway_workflow_merge_and_close_bug` | 合并 MR 并关闭关联 Bug | ✅ |
| `opencode-gateway_workflow_create_mr_for_bug` | 为 Bug 创建修复分支和 MR | ✅ |

**调用示例 - 为 Bug 创建修复 MR**：

```json
{
  "name": "opencode-gateway_workflow_create_mr_for_bug",
  "arguments": {
    "bugId": 123,
    "targetBranch": "develop",
    "changelogUrl": "https://feishu.cn/docx/xxx"
  }
}
```

**调用示例 - 合并 MR 并关闭 Bug**：

```json
{
  "name": "opencode-gateway_workflow_merge_and_close_bug",
  "arguments": {
    "mrId": 456,
    "bugId": 123,
    "comment": "已通过 MR !456 修复"
  }
}
```

### 2.4 消息发送工具 (message.*)

> 通用消息发送能力，适用于所有 Channel（飞书、钉钉等）

| 工具 | 说明 | 需要审批 |
|------|------|:--------:|
| `opencode-gateway_message_send_file` | 发送文件（最大 30MB） | ❌ |
| `opencode-gateway_message_send_image` | 发送图片 | ❌ |
| `opencode-gateway_message_send_rich_text` | 发送富文本（文本+图片） | ❌ |

**发送文件**：

```json
{
  "name": "opencode-gateway_message_send_file",
  "arguments": {
    "file_path": "C:/Users/admin/report.pdf",
    "caption": "测试报告"
  }
}
```

**发送图片**：

```json
{
  "name": "opencode-gateway_message_send_image",
  "arguments": {
    "file_path": "C:/Users/admin/screenshot.png",
    "caption": "UI 截图验证"
  }
}
```

**发送富文本（文本+图片组合）**：

```json
{
  "name": "opencode-gateway_message_send_rich_text",
  "arguments": {
    "text": "## 修复完成\n\n已修复登录页面白屏问题，截图如下：",
    "images": [
      "C:/Users/admin/screenshot1.png",
      "C:/Users/admin/screenshot2.png"
    ]
  }
}
```

### 2.5 飞书官方 MCP 工具 (lark.*)

> 由 `@larksuiteoapi/lark-mcp` 提供，工具前缀为 `opencode-gateway_lark_*`

#### 多维表格 (bitable)

| 工具 | 说明 |
|------|------|
| `opencode-gateway_lark_bitable_v1_app_create` | 创建多维表格 App |
| `opencode-gateway_lark_bitable_v1_appTable_create` | 创建表格 |
| `opencode-gateway_lark_bitable_v1_appTable_list` | 获取表格列表 |
| `opencode-gateway_lark_bitable_v1_appTableField_list` | 获取字段列表 |
| `opencode-gateway_lark_bitable_v1_appTableRecord_create` | 创建记录 |
| `opencode-gateway_lark_bitable_v1_appTableRecord_search` | 搜索记录 |
| `opencode-gateway_lark_bitable_v1_appTableRecord_update` | 更新记录 |

**搜索多维表格记录**：

```json
{
  "name": "opencode-gateway_lark_bitable_v1_appTableRecord_search",
  "arguments": {
    "path": {
      "app_token": "bascnxxxxxx",
      "table_id": "tblxxxxxx"
    },
    "useUAT": false
  }
}
```

#### 云文档 (docx)

| 工具 | 说明 |
|------|------|
| `opencode-gateway_lark_docx_v1_document_rawContent` | 获取文档纯文本内容 |
| `opencode-gateway_lark_docx_builtin_search` | 搜索云文档 |
| `opencode-gateway_lark_docx_builtin_import` | 导入云文档（Markdown 转 Docx） |

**导入 Markdown 为云文档**：

```json
{
  "name": "opencode-gateway_lark_docx_builtin_import",
  "arguments": {
    "data": {
      "file_name": "Bug修复日志 2026-03-26",
      "markdown": "# Bug修复日志\n\n..."
    },
    "useUAT": false
  }
}
```

#### Wiki 知识库

| 工具 | 说明 |
|------|------|
| `opencode-gateway_lark_wiki_v1_node_search` | 搜索 Wiki |
| `opencode-gateway_lark_wiki_v2_space_getNode` | 获取 Wiki 节点信息 |

#### 群聊与消息

| 工具 | 说明 |
|------|------|
| `opencode-gateway_lark_im_v1_chat_create` | 创建群聊 |
| `opencode-gateway_lark_im_v1_chat_list` | 获取群聊列表 |
| `opencode-gateway_lark_im_v1_chatMembers_get` | 获取群成员列表 |
| `opencode-gateway_lark_im_v1_message_create` | 发送消息 |
| `opencode-gateway_lark_im_v1_message_list` | 获取聊天记录 |

**发送飞书消息**：

```json
{
  "name": "opencode-gateway_lark_im_v1_message_create",
  "arguments": {
    "data": {
      "receive_id": "oc_xxx",
      "msg_type": "text",
      "content": "{\"text\":\"✅ Bug 已修复\"}"
    },
    "params": { "receive_id_type": "chat_id" },
    "useUAT": false
  }
}
```

#### 通讯录

| 工具 | 说明 |
|------|------|
| `opencode-gateway_lark_contact_v3_user_batchGetId` | 通过邮箱/手机获取用户 ID |

#### 云文档权限

| 工具 | 说明 |
|------|------|
| `opencode-gateway_lark_drive_v1_permissionMember_create` | 添加文档协作者 |

**重要**：所有飞书工具调用必须设置 `useUAT: false`（使用 Tenant Access Token）。

---

## 三、审批卡片机制

### 3.1 触发条件

以下操作会自动推送审批卡片：

| 工具 | 说明 |
|------|------|
| `zentao_create_bug` | 创建 Bug |
| `zentao_close_bug` | 关闭 Bug |
| `gitlab_create_mr` | 创建 MR |
| `workflow_merge_and_close_bug` | 合并 MR 并关闭 Bug |
| `workflow_create_mr_for_bug` | 为 Bug 创建修复 MR |

### 3.2 卡片示例

```
┌─────────────────────────────────┐
│ 🔀 创建 MR 确认                  │
│                                 │
│ 源分支: fix/login-bug           │
│ 目标分支: develop               │
│ 标题: 修复登录页面白屏问题       │
│                                 │
│ 📄 变更日志: [查看](链接)        │
│                                 │
│ [✅ 确认创建]    [❌ 取消]       │
└─────────────────────────────────┘
```

### 3.3 处理流程

1. AI 调用 MCP 工具
2. Gateway 推送审批卡片到飞书
3. 用户点击"确认"或"取消"
4. Gateway 执行或取消操作
5. 返回结果给 AI（卡片自动更新状态）

---

## 四、标准化工作流

### 4.1 Bug 修复闭环

**触发词**：修复 Bug、根据表格修复、查看报错并修复

**流程**：

```
1. 获取 Bug 详情
   └─ 调用 opencode-gateway_zentao_get_bug
   └─ 或 opencode-gateway_lark_bitable_v1_appTableRecord_search

2. 分析并修复代码
   └─ AI 自主完成（本地文件操作）

3. 验证修复
   └─ 运行测试命令

4. 生成修改日志
   └─ 调用 opencode-gateway_lark_docx_builtin_import 创建云文档

5. 创建 MR（需审批）
   └─ 调用 opencode-gateway_workflow_create_mr_for_bug
   └─ 或 opencode-gateway_gitlab_create_mr

6. 更新状态
   └─ 审批通过后自动更新禅道/多维表格状态

7. 飞书反馈
   └─ 调用 opencode-gateway_message_send_rich_text 发送完成消息
```

### 4.2 周报生成

**触发词**：生成周报、同步周报数据

**流程**：

```
1. 数据聚合
   ├─ git log --since="1 week ago"
   ├─ opencode-gateway_gitlab_get_merge_requests
   └─ opencode-gateway_zentao_list_bugs

2. 提炼总结
   └─ AI 归纳核心产出

3. 填报飞书
   └─ 调用 opencode-gateway_lark_bitable_v1_appTableRecord_create
```

### 4.3 UI 样式调整

**触发词**：修改样式、截图验证、UI 调整

**流程**：

```
1. 定位样式文件
   └─ Grep 搜索关键词

2. 修改代码
   └─ AI 编辑 CSS/SCSS

3. 启动服务
   └─ npm run dev（如未启动）

4. 截图验证
   └─ playwright_browser_take_screenshot

5. 发送截图
   └─ opencode-gateway_message_send_image

6. 生成日志 + 创建 MR
   └─ 同 Bug 修复流程
```

### 4.4 故障排查

**触发词**：排查故障、系统报警、分析日志

**流程**：

```
1. 收集日志
   └─ 读取 error.log 或调用 Sentry MCP

2. 分析原因
   └─ AI 结合代码定位问题

3. 生成报告
   └─ 调用 opencode-gateway_lark_docx_builtin_import

4. 如需修复 → 走 Bug 修复流程
```

---

## 五、修改日志云文档模板

每次代码修改后，**必须**生成修改日志云文档：

```json
{
  "name": "opencode-gateway_lark_docx_builtin_import",
  "arguments": {
    "data": {
      "file_name": "Bug修复日志 2026-03-26",
      "markdown": "# Bug修复日志\n\n**分支**: fix/login-bug\n**提交 ID**: abc123\n**日期**: 2026-03-26\n**关联 ID**: #123\n\n---\n\n## 📋 问题描述\n登录页面白屏\n\n---\n\n## 🔍 问题原因\n路由配置错误导致组件加载失败\n\n---\n\n## 🛠️ 修复方案\n修正路由配置，添加懒加载\n\n---\n\n## 📁 影响文件\n| 文件路径 | 变更类型 | 说明 |\n|----------|----------|------|\n| src/router/index.ts | 修改 | 修正路由配置 |\n\n---\n\n## ✅ 测试建议\n- [ ] 登录页面正常加载\n- [ ] 路由跳转正常\n\n---\n\n*此文档由 OpenCode AI 自动生成*"
    },
    "useUAT": false
  }
}
```

---

## 六、注意事项

### 6.1 Token 使用

- **所有飞书操作**：`useUAT: false`
- **原因**：Tenant Access Token 自动管理，不会失效

### 6.2 权限配置

确保飞书应用有以下权限并已发布：

| 权限 | 用途 |
|------|------|
| `im:message` | 发送消息 |
| `bitable:app` | 操作多维表格 |
| `docx:document` | 操作云文档 |
| `sheets:spreadsheet` | 操作电子表格 |

### 6.3 文档权限

机器人必须是目标文档/表格的**协作者**，并授予"可编辑"权限。

### 6.4 文件发送

使用消息发送工具：

```json
// 发送图片
{
  "name": "opencode-gateway_message_send_image",
  "arguments": {
    "file_path": "C:/Users/admin/screenshot.png",
    "caption": "UI 截图"
  }
}

// 发送文件
{
  "name": "opencode-gateway_message_send_file",
  "arguments": {
    "file_path": "C:/Users/admin/report.pdf",
    "caption": "测试报告"
  }
}
```

---

## 七、完整调用示例

### 场景：修复禅道 Bug #123

```json
// 1. 获取 Bug 详情
{
  "name": "opencode-gateway_zentao_get_bug",
  "arguments": { "bugId": 123 }
}

// 2. AI 分析并修复代码（本地操作）

// 3. 运行测试
// npm run test

// 4. 生成修改日志
{
  "name": "opencode-gateway_lark_docx_builtin_import",
  "arguments": {
    "data": {
      "file_name": "Bug修复日志 2026-03-26",
      "markdown": "# Bug修复日志\n\n..."
    },
    "useUAT": false
  }
}

// 5. 创建 MR（触发审批卡片）
{
  "name": "opencode-gateway_workflow_create_mr_for_bug",
  "arguments": {
    "bugId": 123,
    "targetBranch": "develop",
    "changelogUrl": "https://feishu.cn/docx/xxx"
  }
}

// 6. 飞书反馈
{
  "name": "opencode-gateway_message_send_rich_text",
  "arguments": {
    "text": "✅ Bug #123 已修复\n\n📄 修改日志：https://feishu.cn/docx/xxx",
    "images": ["C:/Users/admin/screenshot.png"]
  }
}
```

---

## 八、环境配置参考

```ini
# .env 配置

# OpenCode
OPENCODE_API_URL=http://127.0.0.1:4096
OPENCODE_TIMEOUT=600000
OPENCODE_MODEL_ID=glm-4.7
OPENCODE_PROVIDER_ID=venus-coding-ai

# 飞书（必需）
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_CONNECTION_MODE=websocket
FEISHU_DOMAIN=feishu

# 飞书官方 MCP（用于云文档、多维表格等）
LARK_MCP_APP_ID=cli_xxx
LARK_MCP_APP_SECRET=xxx

# GitLab（可选）
GITLAB_URL=https://gitlab.example.com/api/v4
GITLAB_TOKEN=glpat-xxx
GITLAB_PROJECT_ID=123

# 禅道（可选）
ZENTAO_BASE_URL=https://zentao.example.com/api.php/v1
ZENTAO_ACCOUNT=xxx
ZENTAO_PASSWORD=xxx
ZENTAO_PROJECT_ID=1

# Gateway
MCP_HTTP_PORT=3100
```

---

## 九、工具清单总览

| 类别 | 前缀 | 说明 |
|------|------|------|
| 禅道 | `opencode-gateway_zentao_*` | Bug 管理 |
| GitLab | `opencode-gateway_gitlab_*` | 代码仓库 |
| 工作流 | `opencode-gateway_workflow_*` | 跨平台编排 |
| 消息 | `opencode-gateway_message_*` | 文件/图片发送 |
| 飞书多维表格 | `opencode-gateway_lark_bitable_*` | 表格操作 |
| 飞书云文档 | `opencode-gateway_lark_docx_*` | 文档操作 |
| 飞书 Wiki | `opencode-gateway_lark_wiki_*` | 知识库 |
| 飞书消息 | `opencode-gateway_lark_im_*` | 群聊消息 |
| 飞书通讯录 | `opencode-gateway_lark_contact_*` | 用户信息 |
| 飞书权限 | `opencode-gateway_lark_drive_*` | 文档权限 |

---

## 十、故障排查

| 问题 | 解决方案 |
|------|----------|
| 权限不足 (403) | 检查飞书应用权限，添加机器人为文档协作者 |
| Token 失效 | 确保使用 `useUAT: false` |
| 找不到资源 | 确认 ID 正确，资源未删除或归档 |
| 审批卡片未推送 | 检查 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 配置 |
| 文件发送失败 | 检查文件路径是否为绝对路径，文件大小是否超过 30MB |

---

**文档版本**：v2.0  
**更新日期**：2026-03-26  
**维护者**：OpenCode Gateway Team