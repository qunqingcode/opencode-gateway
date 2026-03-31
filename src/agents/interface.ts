/**
 * Agent 接口定义
 * 
 * Agent 是 AI 对话能力的抽象，支持多种 AI 后端
 */

import type { Logger } from '../types';

// ============================================================
// Agent 事件类型
// ============================================================

/** 权限请求 */
export interface PermissionRequest {
  id: string;
  sessionId: string;
  title: string;
  type: string;
}

/** 问题请求 */
export interface QuestionRequest {
  id: string;
  sessionId: string;
  questions: Array<{
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
  }>;
}

/** 工具状态 */
export interface ToolStatus {
  name: string;
  status: 'running' | 'completed' | 'error';
  sessionId: string;
}

/** 文本块 */
export interface TextChunk {
  text: string;
  isFinal: boolean;
  sessionId: string;
}

/** Agent 事件 */
export type AgentEvent =
  | { type: 'permission'; data: PermissionRequest }
  | { type: 'question'; data: QuestionRequest }
  | { type: 'tool_status'; data: ToolStatus }
  | { type: 'text_chunk'; data: TextChunk };

/** Agent 事件处理器 */
export type AgentEventHandler = (event: AgentEvent) => Promise<void>;

// ============================================================
// Agent 接口
// ============================================================

/** Agent 配置 */
export interface AgentConfig {
  url: string;
  timeout?: number;
  modelId?: string;
  providerId?: string;
  /** 进度通知配置 */
  progress?: {
    enabled?: boolean;
    showToolStatus?: boolean;
    showTextOutput?: boolean;
  };
}

/** Agent 接口 */
export interface IAgent {
  /** Agent 名称 */
  readonly name: string;

  /** 初始化 */
  init(): Promise<void>;

  /** 创建 Session */
  createSession(): Promise<string>;

  /** 发送 Prompt */
  sendPrompt(sessionId: string, prompt: string): Promise<string | null>;

  /** 注册事件处理器 */
  onEvent(handler: AgentEventHandler): void;

  /** 回复权限请求 */
  replyPermission(sessionId: string, permissionId: string, response: 'allow' | 'deny'): Promise<void>;

  /** 回复问题 */
  replyQuestion(requestId: string, answer: unknown): Promise<void>;

  /** 拒绝问题 */
  rejectQuestion(requestId: string): Promise<void>;

  /** 关闭 */
  shutdown(): Promise<void>;
}

// ============================================================
// Agent 上下文
// ============================================================

/** Prompt 上下文 */
export interface PromptContext {
  chatId: string;
  userId: string;
  channelId: string;
  /** 进度回调 */
  onProgress?: (text: string) => Promise<void>;
  /** 工具状态回调 */
  onToolStatus?: (status: ToolStatus) => Promise<void>;
}