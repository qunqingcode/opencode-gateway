# OpenCode Gateway Integration Skill

> 本文档指导 AI 如何与 OpenCode Gateway 集成，通过 MCP 工具实现代码修改、GitLab MR、禅道管理等操作。

## 概述

OpenCode Gateway 是一个三层架构的 MCP Bridge：

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenCode Gateway                         │
├─────────────────────────────────────────────────────────────┤
│  Gateway 层  │ Session 管理、消息路由、MCP 工具调度          │
│  Channel 层  │ 飞书消息收发、卡片交互、消息格式转换           │
│  MCP 层      │ 禅道、GitLab、Workflow 等工具定义             │
│  API 层      │ 飞书、GitLab、禅道 API 封装                   │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTP (MCP Protocol)
                              │
                         OpenCode
```

## MCP 服务地址

```
URL: http://localhost:3100/mcp
协议: JSON-RPC 2.0 over HTTP
```

## 可用工具

### 禅道工具 (zentao.*)

#### 查询类（无需审批）

| 工具名 | 说明 | 参数 |
|--------|------|------|
| `zentao.get_bug` | 查询 Bug 详情 | `bugId: number` |
| `zentao.list_bugs` | 查询 Bug 列表 | `status?: string, assignee?: string, limit?: number` |
| `zentao.add_comment` | 添加评论 | `bugId: number, comment: string` |

#### 操作类（需要审批）

| 工具名 | 说明 | 参数 |
|--------|------|------|
| `zentao.create_bug` | 创建 Bug | `title: string, description?: string, priority?: string, type?: string, assignee?: string` |
| `zentao.close_bug` | 关闭 Bug | `bugId: number` |

### GitLab 工具 (gitlab.*)

#### 查询类（无需审批）

| 工具名 | 说明 | 参数 |
|--------|------|------|
| `gitlab.get_branches` | 获取分支列表 | `search?: string` |
| `gitlab.get_merge_requests` | 获取 MR 列表 | `state?: string, sourceBranch?: string` |
| `gitlab.create_branch` | 创建分支 | `name: string, ref?: string` |

#### 操作类（需要审批）

| 工具名 | 说明 | 参数 |
|--------|------|------|
| `gitlab.create_mr` | 创建 Merge Request | `sourceBranch: string, targetBranch: string, title: string, description?: string` |

### 工作流工具 (workflow.*)

> 组合 GitLab 和禅道操作，实现跨平台自动化工作流。需要同时配置 GitLab 和禅道。

#### 查询类（无需审批）

| 工具名 | 说明 | 参数 |
|--------|------|------|
| `workflow.get_linked_bugs` | 从 MR 描述提取关联的禅道 Bug ID | `mrId: number` |

#### 操作类（需要审批）

| 工具名 | 说明 | 参数 |
|--------|------|------|
| `workflow.merge_and_close_bug` | 合并 MR 并关闭关联的禅道 Bug | `mrId: number, bugId: number, comment?: string` |
| `workflow.create_mr_for_bug` | 为禅道 Bug 创建修复分支和 MR | `bugId: number, branchName?: string, targetBranch?: string, title?: string` |

## 使用方式

### 1. 配置 OpenCode

编辑 `~/.config/opencode/opencode.json`：

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

### 2. 工具调用示例

#### 查询禅道 Bug

```
用户：帮我查一下 Bug #123 的详情

AI 调用工具：
{
  "name": "zentao.get_bug",
  "arguments": { "bugId": 123 }
}

响应：
{
  "id": 123,
  "title": "登录页面样式异常",
  "status": "active",
  "priority": "high",
  "assignee": "张三"
}
```

#### 创建 Bug（需要审批）

```
用户：帮我创建一个 Bug，标题是"首页加载缓慢"

AI 调用工具：
{
  "name": "zentao.create_bug",
  "arguments": {
    "title": "首页加载缓慢",
    "priority": "high",
    "type": "bug"
  }
}

响应：网关会发送审批卡片到飞书，用户确认后执行
```

#### 创建 GitLab MR（需要审批）

```
用户：帮我从 feature/login 分支创建 MR 到 main

AI 调用工具：
{
  "name": "gitlab.create_mr",
  "arguments": {
    "sourceBranch": "feature/login",
    "targetBranch": "main",
    "title": "feat: 实现登录功能"
  }
}

响应：网关会发送审批卡片到飞书，用户确认后执行
```

#### 合并 MR 并关闭 Bug（工作流）

```
用户：帮我合并 MR !42 并关闭关联的 Bug #123

AI 调用工具：
{
  "name": "workflow.merge_and_close_bug",
  "arguments": {
    "mrId": 42,
    "bugId": 123,
    "comment": "已通过 MR !42 修复"
  }
}

响应：网关会发送审批卡片，确认后自动执行：
1. 合并 GitLab MR !42
2. 在禅道 Bug #123 添加评论
3. 关闭禅道 Bug #123
```

#### 为 Bug 创建修复 MR（工作流）

```
用户：帮我为 Bug #456 创建一个修复分支

AI 调用工具：
{
  "name": "workflow.create_mr_for_bug",
  "arguments": {
    "bugId": 456,
    "targetBranch": "main"
  }
}

响应：网关会发送审批卡片，确认后自动执行：
1. 创建分支 fix/bug-456
2. 创建 MR 指向 main
3. 在 Bug #456 添加修复记录评论
```

## 审批流程

对于需要审批的操作，网关会：

1. **发送审批卡片** 到飞书聊天
2. **等待用户确认** 用户点击"确认"或"取消"
3. **执行或取消** 确认后执行操作，取消则终止

```
┌─────────────────────────────────────┐
│  🐛 创建 Bug 确认                   │
│                                     │
│  标题: 首页加载缓慢                  │
│  优先级: 高                         │
│  类型: Bug                          │
│                                     │
│  [✅ 确认创建]  [❌ 取消]            │
└─────────────────────────────────────┘
```

## 直接 HTTP 调用

如果需要直接调用 MCP 工具（不通过 OpenCode）：

### 初始化

```bash
curl -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {}
  }'
```

### 获取工具列表

```bash
curl -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list"
  }'
```

### 调用工具

```bash
curl -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "zentao.get_bug",
      "arguments": { "bugId": 1 }
    }
  }'
```

## 飞书集成

### 消息流程

```
飞书消息 → Gateway → OpenCode AI → MCP 工具调用 → 飞书卡片/回复
```

### 卡片交互

用户在飞书中点击卡片按钮后：

1. Gateway 接收交互事件
2. 解析 action 和参数
3. 执行对应操作
4. 返回结果卡片

## 错误处理

工具调用失败时返回：

```json
{
  "content": [{
    "type": "text",
    "text": "Error: 具体错误信息"
  }],
  "isError": true
}
```

常见错误：

| 错误 | 原因 | 解决方案 |
|------|------|----------|
| `Unknown MCP server` | 服务名错误 | 检查工具名前缀 |
| `Unknown tool` | 工具名错误 | 检查工具名拼写 |
| `禅道未配置` | 环境变量缺失 | 配置 ZENTAO_* 变量 |
| `GitLab 未配置` | 环境变量缺失 | 配置 GITLAB_* 变量 |

## 最佳实践

### 1. 优先使用查询工具

查询类工具无需审批，响应更快：

```
✅ 好：先查询 Bug 详情，再决定是否关闭
❌ 差：直接尝试关闭可能不存在的 Bug
```

### 2. 批量操作分步执行

```
用户：帮我关闭所有已解决的 Bug

AI 流程：
1. 调用 zentao.list_bugs 查询列表
2. 向用户确认要关闭的 Bug
3. 逐个调用 zentao.close_bug
```

### 3. 提供清晰的审批信息

创建需要审批的操作时，提供完整的参数：

```
✅ 好：
zentao.create_bug({
  title: "首页加载超过 5 秒",
  description: "用户反馈首页加载缓慢，经测试平均加载时间超过 5 秒",
  priority: "high"
})

❌ 差：
zentao.create_bug({
  title: "首页慢"
})
```

## 环境变量参考

网关服务需要以下环境变量：

```bash
# 必需
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
OPENCODE_API_URL=http://127.0.0.1:4096

# MCP 服务端口
MCP_HTTP_PORT=3100

# GitLab（可选）
GITLAB_URL=https://gitlab.example.com/api/v4
GITLAB_TOKEN=glpat-xxx
GITLAB_PROJECT_ID=123

# 禅道（可选）
ZENTAO_BASE_URL=https://zentao.example.com/api.php/v1
ZENTAO_ACCOUNT=username
ZENTAO_PASSWORD=password
ZENTAO_PROJECT_ID=1
```

## 扩展开发

### 添加新工具

在网关项目中添加新的 MCP 工具：

```typescript
// src/mcp-servers/mytool/index.ts
import { BaseMCPServer } from '../base';
import { createTool } from '../types';

export class MyToolMCPServer extends BaseMCPServer {
  readonly name = 'mytool';

  constructor(config: MyConfig, logger: Logger) {
    super(config, logger);
    
    this.registerTools([
      createTool({
        name: 'do_action',
        description: '执行操作',
        inputSchema: {
          type: 'object',
          properties: {
            param: { type: 'string', description: '参数说明' }
          },
          required: ['param']
        },
        execute: async (args, context) => {
          // 实现逻辑
          return { success: true, output: '结果' };
        },
        requiresApproval: false // 是否需要审批
      })
    ]);
  }
}
```

## 联系与支持

- 网关仓库：内部项目
- 问题反馈：联系运维团队

---

**版本**: 3.1.0  
**更新日期**: 2026-03-23