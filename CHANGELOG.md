# Changelog

All notable changes to this project will be documented in this file.

## [3.1.0] - 2026-03-23

### 重构 - 参考 OpenClaw 架构设计

#### 目录变更
- `src/providers/` → `src/api/` - 重命名为更准确的名称
- `BaseProvider` → `BaseClient` - 类名更清晰

#### 架构改进
- **Gateway 层** - 纯路由，不思考、不推理、不决策
- **Channel 层** - 消息格式转换，不直接依赖 API Client
- **MCP Server 层** - 工具定义和审批流程
- **API 层** - 纯 API 封装，无业务逻辑

#### 新增
- `src/app.ts` - 声明式配置入口
- `src/api/index.ts` - API Client 统一导出
- `StdioMCPServer` - 第三方 MCP Server 代理

#### 文档更新
- README.md - 更新架构图和项目结构
- docs/development-guide.md - 更新开发指南
- docs/integrate-third-party-mcp.md - 第三方 MCP 集成指南

### 设计原则

参考 OpenClaw 的三层架构：

1. **Gateway 不思考** - 只做路由和 Session 管理
2. **Channel 不依赖 API** - 通过注入获得能力
3. **API Client 是纯函数** - 只封装 API，不包含业务
4. **MCP Server 是业务层** - 定义工具、审批流程

---

## [3.0.0] - 2026-03-20

### 新增
- 三层架构设计 (Channels → Gateway → MCP Servers)
- 声明式配置入口
- 飞书审批卡片支持
- GitLab / 禅道 / Workflow MCP Server
- StdioMCPServer 代理第三方 MCP