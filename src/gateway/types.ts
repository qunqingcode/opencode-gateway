/**
 * Gateway 层类型定义
 * 
 * 职责：
 * 1. 定义 Gateway 核心接口
 * 2. Session 管理
 * 3. MCP 客户端交互
 */

import type { StandardMessage, InteractionEvent, InteractionResult, Logger } from '../channels/types';

// 重新导出这些类型
export type { StandardMessage, InteractionEvent, InteractionResult, Logger } from '../channels/types';

// ============================================================
// Gateway 配置
// ============================================================

/** Gateway 配置 */
export interface GatewayConfig {
  /** OpenCode 配置 */
  opencode: {
    url: string;
    timeout?: number;
    modelId?: string;
    providerId?: string;
  };
  /** MCP Server 配置路径 */
  mcpServers?: MCPServerConfig[];
}

/** MCP Server 配置 */
export interface MCPServerConfig {
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

// ============================================================
// Session 管理
// ============================================================

/** Session 信息 */
export interface SessionInfo {
  id: string;
  chatId: string;
  createdAt: number;
  lastActiveAt: number;
}

/** Session 管理器接口 */
export interface ISessionManager {
  /** 获取或创建 Session */
  getOrCreate(chatId: string): Promise<string>;
  
  /** 获取 Session ID */
  getSessionId(chatId: string): string | undefined;
  
  /** 获取 Session 信息 */
  getSessionInfo(chatId: string): SessionInfo | undefined;
  
  /** 清理过期 Session */
  cleanupExpired(): void;
}

// ============================================================
// MCP 客户端
// ============================================================

/** MCP 工具定义 */
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      items?: { type: string };
    }>;
    required?: string[];
  };
}

/** MCP 工具调用请求 */
export interface MCPToolCallRequest {
  server: string;
  tool: string;
  arguments: Record<string, unknown>;
}

/** MCP 工具调用结果 */
export interface MCPToolCallResult {
  success: boolean;
  output?: unknown;
  error?: string;
  /** 是否需要审批 */
  requiresApproval?: boolean;
  /** 审批卡片数据 */
  approvalCard?: unknown;
}

/** MCP 客户端接口 */
export interface IMCPClient {
  /** 发现所有工具 */
  discoverTools(): Promise<MCPToolDefinition[]>;
  
  /** 获取指定 Server 的工具 */
  getTools(server: string): MCPToolDefinition[];
  
  /** 调用工具 */
  callTool(request: MCPToolCallRequest, context: ToolContext): Promise<MCPToolCallResult>;
  
  /** 注册 Server */
  registerServer(name: string, server: IMCPServer): void;
  
  /** 获取所有服务器名称 */
  getServerNames(): string[];
}

/** MCP Server 接口 */
export interface IMCPServer {
  name: string;
  description?: string;
  listTools(): MCPToolDefinition[];
  callTool(name: string, args: Record<string, unknown>, context: ToolContext): Promise<MCPToolCallResult>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

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
  /** 发送卡片 */
  sendCard(card: unknown): Promise<void>;
  
  /** 日志 */
  logger: Logger;
}

// ============================================================
// Gateway 接口
// ============================================================

/** Gateway 接口 */
export interface IGateway {
  /** 初始化 */
  init(): Promise<void>;
  
  /** 处理消息 */
  processMessage(message: StandardMessage): Promise<void>;
  
  /** 处理交互 */
  processInteraction(event: InteractionEvent): Promise<InteractionResult>;
  
  /** 获取 MCP 客户端 */
  getMCPClient(): IMCPClient;
  
  /** 获取 Session 管理器 */
  getSessionManager(): ISessionManager;
  
  /** 关闭 */
  shutdown(): Promise<void>;
}

// ============================================================
// Hook 系统
// ============================================================

/** Hook 类型 */
export type HookType = 
  | 'beforeMessageProcess'
  | 'afterMessageProcess'
  | 'beforeToolCall'
  | 'afterToolCall'
  | 'onSessionCreate'
  | 'onSessionExpire';

/** Hook 处理器 */
export type HookHandler<T = unknown> = (context: T) => Promise<T | void>;

/** Hook 上下文 */
export interface MessageHookContext {
  message: StandardMessage;
  sessionId: string;
}

export interface ToolCallHookContext {
  request: MCPToolCallRequest;
  context: ToolContext;
  result?: MCPToolCallResult;
}