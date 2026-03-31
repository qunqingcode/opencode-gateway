/**
 * Channel 基类
 * 
 * Channel = IM 渠道（有连接、有状态）
 * Client = API 客户端（无状态）
 * 
 * BaseChannel 抽象 Channel 层的通用逻辑：
 * - 连接状态管理
 * - 消息/交互处理器管理
 * - 健康检查默认实现
 */

import type { Logger } from '../types';
import type {
  IChannel,
  MessageHandler,
  InteractionHandler,
  StandardMessage,
  InteractionEvent,
  InteractionResult,
  SendResult,
} from './types';

// ============================================================
// 连接状态
// ============================================================

export interface ChannelConnectionState {
  /** 是否已连接 */
  connected: boolean;
  /** 连接时间 */
  connectedAt?: number;
  /** 断开时间 */
  disconnectedAt?: number;
  /** 最后错误 */
  lastError?: string;
}

// ============================================================
// BaseChannel 抽象基类
// ============================================================

/**
 * Channel 基类
 * 
 * 所有 IM 渠道（飞书、钉钉、Slack 等）的基类
 * 实现 IChannel 接口，提供通用的处理器管理和状态追踪
 */
export abstract class BaseChannel implements IChannel {
  // ============================================================
  // IChannel 接口属性
  // ============================================================

  abstract readonly id: string;
  abstract readonly name: string;

  // ============================================================
  // 内部状态
  // ============================================================

  protected logger: Logger;
  protected connectionState: ChannelConnectionState = { connected: false };
  
  private messageHandler: MessageHandler | null = null;
  private interactionHandler: InteractionHandler | null = null;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  // ============================================================
  // 连接管理（子类实现）
  // ============================================================

  abstract connect(): Promise<void>;
  abstract disconnect(): void;
  
  // ============================================================
  // 消息发送（子类实现）
  // ============================================================
  
  /**
   * 发送文本消息
   * 子类必须实现此方法
   */
  abstract sendText(chatId: string, text: string, replyToId?: string): Promise<SendResult>;
  
  /**
   * 发送卡片消息
   * 子类必须实现此方法
   */
  abstract sendCard(chatId: string, card: unknown, replyToId?: string): Promise<SendResult>;
  
  /**
   * 发送富文本消息（文本 + 图片）
   * 子类必须实现此方法
   */
  abstract sendRichText(chatId: string, text: string, images: string[], replyToId?: string): Promise<SendResult>;
  
  /**
   * 发送文件
   * 子类必须实现此方法
   */
  abstract sendFile(chatId: string, filePath: string, replyToId?: string): Promise<SendResult>;

  // ============================================================
  // 处理器注册
  // ============================================================

  /**
   * 注册消息处理器
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
    this.logger.debug?.(`[${this.name}] Message handler registered`);
  }

  /**
   * 注册交互处理器
   */
  onInteraction(handler: InteractionHandler): void {
    this.interactionHandler = handler;
    this.logger.debug?.(`[${this.name}] Interaction handler registered`);
  }

  // ============================================================
  // 处理器调用（供子类使用）
  // ============================================================

  /**
   * 调用消息处理器
   * 子类在收到消息时调用此方法，传入已标准化的消息
   */
  protected async handleMessage(message: StandardMessage): Promise<void> {
    if (this.messageHandler) {
      try {
        await this.messageHandler(message);
      } catch (err) {
        this.logger.error(`[${this.name}] Message handler error: ${(err as Error).message}`);
      }
    }
  }

  /**
   * 调用交互处理器
   * 子类在收到交互事件时调用此方法，传入已标准化的事件
   */
  protected async handleInteraction(event: InteractionEvent): Promise<InteractionResult> {
    if (this.interactionHandler) {
      try {
        return await this.interactionHandler(event);
      } catch (err) {
        this.logger.error(`[${this.name}] Interaction handler error: ${(err as Error).message}`);
        return { toast: { type: 'error', content: '处理失败' } };
      }
    }
    return { toast: { type: 'info', content: '已处理' } };
  }

  /**
   * 检查是否有消息处理器
   */
  protected hasMessageHandler(): boolean {
    return this.messageHandler !== null;
  }

  /**
   * 检查是否有交互处理器
   */
  protected hasInteractionHandler(): boolean {
    return this.interactionHandler !== null;
  }

  // ============================================================
  // 连接状态管理
  // ============================================================

  /**
   * 标记已连接
   */
  protected markConnected(): void {
    this.connectionState = {
      connected: true,
      connectedAt: Date.now(),
    };
    this.logger.info(`[${this.name}] Connected`);
  }

  /**
   * 标记已断开
   */
  protected markDisconnected(error?: string): void {
    this.connectionState = {
      connected: false,
      disconnectedAt: Date.now(),
      lastError: error,
    };
    this.logger.info(`[${this.name}] Disconnected${error ? `: ${error}` : ''}`);
  }

  /**
   * 获取连接状态
   */
  getConnectionState(): ChannelConnectionState {
    return this.connectionState;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.connectionState.connected;
  }

  // ============================================================
  // 健康检查
  // ============================================================

  /**
   * 健康检查
   * 子类可覆盖以提供更详细的检查
   */
  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    if (this.isConnected()) {
      const duration = this.connectionState.connectedAt
        ? Math.floor((Date.now() - this.connectionState.connectedAt) / 1000)
        : 0;
      return {
        healthy: true,
        message: `Connected for ${duration}s`,
      };
    }
    return {
      healthy: false,
      message: this.connectionState.lastError || 'Not connected',
    };
  }
}