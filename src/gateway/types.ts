/**
 * Gateway 类型定义
 */

import type { Logger } from '../types';
import type { IAgent, AgentConfig, AgentEvent } from '../agents';
import type { ToolRegistry, ToolContext, ToolResult } from '../tools';
import type { IChannel } from '../channels';

// ============================================================
// Gateway 配置
// ============================================================

export interface GatewayConfig {
  /** Agent 配置 */
  agent: AgentConfig;
  /** 数据目录 */
  dataDir?: string;
}

// ============================================================
// Session 类型
// ============================================================

/** Session 信息 */
export interface Session {
  id: string;
  name: string;
  agentSessionId: string;
  chatId: string;
  createdAt: number;
  updatedAt: number;
}

// ============================================================
// 消息类型
// ============================================================

/** 标准化消息 */
export interface StandardMessage {
  source: {
    channelId: string;
    chatId: string;
    userId: string;
    messageId: string;
    chatType: 'p2p' | 'group';
  };
  content: {
    text?: string;
  };
}

/** 交互事件 */
export interface InteractionEvent {
  channelId: string;
  chatId: string;
  userId: string;
  messageId: string;
  action: string;
  value: Record<string, unknown>;
}

/** 交互结果 */
export interface InteractionResult {
  toast?: {
    type: 'success' | 'error' | 'info';
    content: string;
  };
  card?: unknown;
}

// ============================================================
// Gateway 接口
// ============================================================

export interface IGateway {
  /** 初始化 */
  init(): Promise<void>;

  /** 注册渠道 */
  registerChannel(channel: IChannel): void;

  /** 注册工具 */
  registerTool(tool: unknown): void;

  /** 处理消息 */
  processMessage(message: StandardMessage): Promise<void>;

  /** 处理交互 */
  processInteraction(event: InteractionEvent): Promise<InteractionResult>;

  /** 获取工具注册表 */
  getToolRegistry(): ToolRegistry;

  /** 关闭 */
  shutdown(): Promise<void>;
}