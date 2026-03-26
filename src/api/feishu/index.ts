/**
 * 飞书 API 模块
 * 
 * 提供：
 * - FeishuClient: 飞书 API 客户端（发送消息、卡片等）
 * - FeishuConnection: WebSocket/Webhook 连接管理
 * - CardBuilder: 卡片构建器
 * 
 * 参考 OpenClaw 的 Channel Adapter 设计
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import { BaseClient } from '../base';
import type { Logger } from '../../types';
import { sendTextMessage, sendMediaMessage, sendCardMessage, createFeishuClient, uploadAndSendFile, sendRichTextMessage, uploadImage } from './send';
import { startFeishuProvider, FeishuProviderOptions } from './receive';

// ============================================================
// 导出卡片模块
// ============================================================

export {
  // 卡片交互协议
  createFeishuCardInteractionEnvelope,
  buildFeishuCardInteractionContext,
  decodeFeishuCardAction,
  FEISHU_CARD_DEFAULT_TTL_MS,

  // 卡片构建器
  FeishuCardBuilder,
  ActionBuilder,
  buildFeishuCardButton,
  createTextCard,
  createConfirmCard,
  createListCard,

  // 类型
  type FeishuCard,
  type FeishuCardInteractionEnvelope,
  type DecodedFeishuCardAction,
} from './card';

// ============================================================
// 导出发送功能
// ============================================================

export {
  createFeishuClient,
  sendTextMessage,
  sendMediaMessage,
  sendCardMessage,
  uploadAndSendFile,
  sendRichTextMessage,
  uploadImage,
  type FeishuSendResult,
} from './send';

// ============================================================
// 导出连接管理
// ============================================================

export {
  startFeishuProvider,
  type FeishuProviderOptions,
} from './receive';

// ============================================================
// 配置类型
// ============================================================

export interface FeishuConfig {
  id: string;
  appId: string;
  appSecret: string;
  connectionMode?: 'websocket' | 'webhook';
  domain?: 'feishu' | 'lark';
  webhookPort?: number;
  webhookPath?: string;
  encryptKey?: string;
  verificationToken?: string;
  botNames?: string[];
}

// ============================================================
// FeishuClient - 飞书 API 客户端
// ============================================================

/**
 * 飞书 API 客户端
 * 
 * 封装消息发送、卡片推送等 API 调用
 * 继承 BaseClient 保持与 GitLabClient、ZentaoClient 的一致性
 */
export class FeishuClient extends BaseClient {
  readonly name = 'Feishu';
  
  readonly id: string;
  
  private client: InstanceType<typeof Lark.Client>;
  private config: FeishuConfig;
  private messageHandler: ((event: any) => Promise<void>) | null = null;
  private interactionHandler: ((event: any) => Promise<unknown>) | null = null;
  private stopFn: (() => void) | null = null;

  constructor(config: FeishuConfig, logger: Logger) {
    const domain = config.domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn';
    super(domain, logger);
    
    this.id = config.id;
    this.config = config;

    this.client = createFeishuClient({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: config.domain,
    });
  }

  // ============================================================
  // 消息发送
  // ============================================================

  async sendText(chatId: string, text: string, replyToId?: string) {
    return sendTextMessage(this.client, chatId, text, replyToId);
  }

  async sendMedia(chatId: string, mediaUrl: string, text?: string) {
    return sendMediaMessage(this.client, chatId, mediaUrl, text);
  }

  async sendCard(chatId: string, card: unknown, replyToId?: string) {
    return sendCardMessage(this.client, chatId, card as object, replyToId);
  }

  /**
   * 上传并发送文件/图片
   */
  async uploadAndSendFile(filePath: string, chatId: string, replyToId?: string) {
    return uploadAndSendFile(
      this.client,
      filePath,
      chatId,
      replyToId || '',
      {
        info: (msg) => this.logger.info(`[Feishu] ${msg}`),
        error: (msg) => this.logger.error(`[Feishu] ${msg}`),
      }
    );
  }

  /**
   * 获取底层 Lark Client
   */
  getNativeClient(): InstanceType<typeof Lark.Client> {
    return this.client;
  }

  // ============================================================
  // 连接管理
  // ============================================================

  async connect(): Promise<void> {
    const options: FeishuProviderOptions = {
      account: {
        accountId: this.id,
        appId: this.config.appId,
        appSecret: this.config.appSecret,
        connectionMode: this.config.connectionMode,
        domain: this.config.domain,
        webhookPort: this.config.webhookPort,
        webhookPath: this.config.webhookPath,
        encryptKey: this.config.encryptKey,
        verificationToken: this.config.verificationToken,
        botNames: this.config.botNames,
      },
      log: {
        info: (msg) => this.logger.info(`[Feishu] ${msg}`),
        error: (msg) => this.logger.error(`[Feishu] ${msg}`),
        warn: (msg) => this.logger.warn?.(`[Feishu] ${msg}`),
        debug: (msg) => this.logger.debug?.(`[Feishu] ${msg}`),
      },
      onMessage: async (event) => {
        if (this.messageHandler) {
          await this.messageHandler(event);
        }
      },
      onCardAction: this.interactionHandler
        ? async (event) => {
          return this.interactionHandler!(event);
        }
        : undefined,
    };

    const provider = startFeishuProvider(options);
    this.stopFn = provider.stop;
    
    this.logger.info(`[Feishu] Connected (${this.config.connectionMode || 'websocket'})`);
  }

  disconnect(): void {
    if (this.stopFn) {
      this.stopFn();
      this.stopFn = null;
    }
    this.logger.info(`[Feishu] Disconnected`);
  }

  // ============================================================
  // 事件处理
  // ============================================================

  onMessage(handler: (event: any) => Promise<void>): void {
    this.messageHandler = handler;
  }

  onInteraction(handler: (event: any) => Promise<unknown>): void {
    this.interactionHandler = handler;
  }

  // ============================================================
  // 健康检查
  // ============================================================

  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    return { healthy: true, message: 'Connected' };
  }
}

// ============================================================
// 工厂函数
// ============================================================

export function createFeishuApiClient(config: FeishuConfig, logger: Logger): FeishuClient {
  return new FeishuClient(config, logger);
}