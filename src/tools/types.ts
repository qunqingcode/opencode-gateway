/**
 * 工具层类型定义
 * 
 * 工具 = 业务逻辑，不关心调用方式
 */

import type { Logger } from '../types';

// ============================================================
// 工具上下文
// ============================================================

/** 工具执行上下文 */
export interface ToolContext {
  /** 聊天 ID */
  chatId: string;
  /** 用户 ID */
  userId: string;
  /** 消息 ID */
  messageId?: string;
  /** Session ID */
  sessionId: string;

  /** 发送文本消息 */
  sendText(text: string): Promise<void>;
  /** 发送富文本消息 */
  sendRichText?(text: string, images: string[]): Promise<void>;
  /** 发送文件 */
  sendFile?(filePath: string): Promise<void>;
  /** 发送卡片 */
  sendCard(card: unknown): Promise<void>;
  /** 发送媒体 */
  sendMedia?(url: string, text?: string): Promise<void>;

  /** 日志 */
  logger: Logger;
}

// ============================================================
// 工具定义
// ============================================================

/** JSON Schema 类型 */
export interface JSONSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description: string;
    enum?: string[];
    items?: { type: string };
  }>;
  required?: string[];
}

/** 工具定义 */
export interface ToolDefinition {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 输入 Schema */
  inputSchema: JSONSchema;
  /** 是否需要审批 */
  requiresApproval?: boolean;
  /** 是否为内部工具 */
  internal?: boolean;
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
// 工具接口
// ============================================================

/** 工具接口 */
export interface ITool {
  /** 工具定义 */
  readonly definition: ToolDefinition;

  /** 执行工具 */
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;

  /** 启动（可选） */
  start?(): Promise<void>;

  /** 停止（可选） */
  stop?(): Promise<void>;
}

// ============================================================
// 工具构建器
// ============================================================

/** 工具构建选项 */
export interface ToolBuilderOptions {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
  requiresApproval?: boolean;
  internal?: boolean;
}

/**
 * 创建工具定义
 */
export function createTool(options: ToolBuilderOptions): ToolDefinition & { execute: ToolBuilderOptions['execute'] } {
  return {
    name: options.name,
    description: options.description,
    inputSchema: options.inputSchema,
    execute: options.execute,
    requiresApproval: options.requiresApproval,
    internal: options.internal,
  };
}