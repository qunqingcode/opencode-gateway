/**
 * MCP Servers 模块
 * 
 * 职责：
 * 1. 统一导出所有 MCP Server
 * 2. 提供 Server 注册和发现
 */

// ============================================================
// 类型导出
// ============================================================

export type {
  ToolDefinition,
  ToolResult,
  IMCPServer,
  MCPServerConfig,
  ToolBuilderOptions,
} from './types';

// ============================================================
// 基础组件导出
// ============================================================

export { BaseMCPServer } from './base';
export { createTool } from './types';

// ============================================================
// MCP Server 导出
// ============================================================

export { ZentaoMCPServer, createZentaoMCPServer } from './zentao';
export type { ZentaoMCPServerConfig } from './zentao';

export { GitLabMCPServer, createGitLabMCPServer } from './gitlab';
export type { GitLabMCPServerConfig } from './gitlab';

export { WorkflowMCPServer, createWorkflowMCPServer } from './workflow';
export type { WorkflowMCPServerConfig } from './workflow';

export { StdioMCPServer, createStdioMCPServer } from './stdio';
export type { StdioMCPServerConfig } from './stdio';

// ============================================================
// Server Registry
// ============================================================

import type { IMCPServer, MCPServerConfig } from './types';
import type { Logger } from '../channels/types';
import { createZentaoMCPServer, ZentaoMCPServerConfig } from './zentao';
import { createGitLabMCPServer, GitLabMCPServerConfig } from './gitlab';
import { createWorkflowMCPServer, WorkflowMCPServerConfig } from './workflow';
import { createStdioMCPServer, StdioMCPServerConfig } from './stdio';

type ServerFactory = (config: Record<string, unknown>, logger: Logger) => IMCPServer;

const serverRegistry = new Map<string, ServerFactory>();

// 注册内置 Servers
serverRegistry.set('zentao', (config, logger) => 
  createZentaoMCPServer(config as unknown as ZentaoMCPServerConfig, logger)
);
serverRegistry.set('gitlab', (config, logger) => 
  createGitLabMCPServer(config as unknown as GitLabMCPServerConfig, logger)
);
serverRegistry.set('workflow', (config, logger) => 
  createWorkflowMCPServer(config as unknown as WorkflowMCPServerConfig, logger)
);
// Stdio MCP Server（用于集成官方/第三方 MCP）
serverRegistry.set('stdio', (config, logger) => 
  createStdioMCPServer(config as unknown as StdioMCPServerConfig, logger)
);

/**
 * 创建 MCP Server 实例
 */
export function createMCPServer(
  name: string,
  config: Record<string, unknown>,
  logger: Logger
): IMCPServer | null {
  const factory = serverRegistry.get(name);
  if (!factory) {
    logger.warn(`Unknown MCP server: ${name}`);
    return null;
  }
  return factory(config, logger);
}

/**
 * 获取已注册的 Server 类型
 */
export function getRegisteredServerTypes(): string[] {
  return Array.from(serverRegistry.keys());
}

/**
 * 注册自定义 Server
 */
export function registerMCPServer(name: string, factory: ServerFactory): void {
  serverRegistry.set(name, factory);
}