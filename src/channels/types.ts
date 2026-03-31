/**
 * Channel 层类型定义
 * 
 * Channel = IM 渠道，有连接、有状态
 * 与 Client（纯 API 无状态）区分
 */

import type { Logger } from '../types';

// ============================================================
// Channel 接口
// ============================================================

/** Channel 接口 - IM 渠道 */
export interface IChannel {
  /** 渠道 ID */
  readonly id: string;
  
  /** 渠道名称 */
  readonly name: string;
  
  /** 连接 */
  connect(): Promise<void>;
  
  /** 断开 */
  disconnect(): void;
  
  /** 注册消息处理器 */
  onMessage(handler: MessageHandler): void;
  
  /** 注册交互处理器 */
  onInteraction?(handler: InteractionHandler): void;
  
  /** 健康检查 */
  healthCheck(): Promise<{ healthy: boolean; message: string }>;
  
  // ============================================================
  // 消息发送（通用接口）
  // ============================================================
  
  /** 发送文本消息 */
  sendText(chatId: string, text: string, replyToId?: string): Promise<SendResult>;
  
  /** 发送卡片消息 */
  sendCard(chatId: string, card: unknown, replyToId?: string): Promise<SendResult>;
  
  /** 发送富文本消息（文本 + 图片） */
  sendRichText(chatId: string, text: string, images: string[], replyToId?: string): Promise<SendResult>;
  
  /** 发送文件 */
  sendFile(chatId: string, filePath: string, replyToId?: string): Promise<SendResult>;
}

/** 消息发送结果 */
export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/** 消息处理器 - 接收标准化消息 */
export type MessageHandler = (message: StandardMessage) => Promise<void>;

/** 交互处理器 - 接收标准化交互事件 */
export type InteractionHandler = (event: InteractionEvent) => Promise<InteractionResult>;

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