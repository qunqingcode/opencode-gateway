/**
 * MCP Servers 层类型定义
 * 
 * 职责：
 * 1. 定义 MCP Server 接口
 * 2. 工具定义格式
 * 3. 执行上下文
 */

import type { MCPToolDefinition, MCPToolCallResult, ToolContext } from '../gateway/types';

// ============================================================
// 工具执行结果 (前置定义)
// ============================================================

/** 工具执行结果 */
export interface ToolResult {
  success: boolean;
  output?: unknown;
  error?: string;
  /** 是否需要审批 */
  requiresApproval?: boolean;
  /** 审批卡片数据 */
  approvalCard?: unknown;
}

// ============================================================
// 工具定义
// ============================================================

/** 工具定义 (扩展版) */
export interface ToolDefinition extends MCPToolDefinition {
  /** 执行函数 */
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
  
  /** 是否需要审批 */
  requiresApproval?: boolean;
  
  /** 是否为内部工具（不暴露给 AI，仅用于卡片回调） */
  internal?: boolean;
  
  /** 权限要求 */
  permissions?: string[];
}

/** 工具执行结果 */
export interface ToolResult {
  success: boolean;
  output?: unknown;
  error?: string;
  /** 是否需要审批 */
  requiresApproval?: boolean;
  /** 审批卡片数据 */
  approvalCard?: unknown;
}

// ============================================================
// MCP Server 接口
// ============================================================

/** MCP Server 接口 */
export interface IMCPServer {
  /** Server 名称 */
  readonly name: string;
  
  /** Server 描述 */
  readonly description?: string;
  
  /** 获取工具列表 */
  listTools(): ToolDefinition[];
  
  /** 执行工具调用 */
  callTool(name: string, args: Record<string, unknown>, context: ToolContext): Promise<MCPToolCallResult>;
  
  /** 启动 Server */
  start(): Promise<void>;
  
  /** 停止 Server */
  stop(): Promise<void>;
}

/** MCP Server 配置 */
export interface MCPServerConfig {
  name: string;
  enabled: boolean;
  [key: string]: unknown;
}

// ============================================================
// 工具构建器
// ============================================================

/** 工具构建选项 */
export interface ToolBuilderOptions {
  name: string;
  description: string;
  inputSchema: ToolDefinition['inputSchema'];
  execute: ToolDefinition['execute'];
  requiresApproval?: boolean;
  internal?: boolean;
  permissions?: string[];
}

/**
 * 创建工具定义
 */
export function createTool(options: ToolBuilderOptions): ToolDefinition {
  return {
    name: options.name,
    description: options.description,
    inputSchema: options.inputSchema,
    execute: options.execute,
    requiresApproval: options.requiresApproval,
    internal: options.internal,
    permissions: options.permissions,
  };
}