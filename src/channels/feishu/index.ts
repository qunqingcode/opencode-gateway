/**
 * 飞书 Channel 模块
 * 
 * 提供：
 * - FeishuChannel: 飞书 IM 渠道（连接、消息、卡片）
 * - FeishuCardBuilder: 卡片构建器
 * - 发送/接收功能函数
 * 
 * Channel = IM 渠道（有连接、有状态）
 * Client = API 客户端（无状态）
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import { BaseChannel } from '../base';
import type { Logger } from '../../types';
import type { StandardMessage, InteractionEvent, InteractionResult, SendResult } from '../types';
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
// FeishuChannel - 飞书 IM 渠道
// ============================================================

/**
 * 飞书 Channel
 * 
 * 实现 IM 渠道功能：
 * - WebSocket/Webhook 连接管理
 * - 消息接收与发送
 * - 卡片交互处理
 * 
 * 继承 BaseChannel 保持与其他 Channel 的一致性
 */
export class FeishuChannel extends BaseChannel {
  readonly name = 'Feishu';
  readonly id: string;

  private client: InstanceType<typeof Lark.Client>;
  private config: FeishuConfig;
  private stopFn: (() => void) | null = null;

  constructor(config: FeishuConfig, logger: Logger) {
    super(logger);

    this.id = config.id;
    this.config = config;

    this.client = createFeishuClient({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: config.domain,
    });
  }

  // ============================================================
  // 消息发送（IChannel 接口实现）
  // ============================================================

  async sendText(chatId: string, text: string, replyToId?: string): Promise<SendResult> {
    this.logger.info(`[FeishuChannel] sendText to ${chatId}`);
    try {
      const result = await sendTextMessage(this.client, chatId, text, replyToId);
      this.logger.info(`[FeishuChannel] sendText result: ok=${result.ok}`);
      return result;
    } catch (err) {
      this.logger.error(`[FeishuChannel] sendText error: ${(err as Error).message}`);
      return { ok: false, error: (err as Error).message };
    }
  }

  async sendCard(chatId: string, card: unknown, replyToId?: string): Promise<SendResult> {
    this.logger.info(`[FeishuChannel] sendCard to ${chatId}`);
    try {
      const result = await sendCardMessage(this.client, chatId, card as object, replyToId);
      this.logger.info(`[FeishuChannel] sendCard result: ok=${result.ok}`);
      return result;
    } catch (err) {
      this.logger.error(`[FeishuChannel] sendCard error: ${(err as Error).message}`);
      return { ok: false, error: (err as Error).message };
    }
  }

  async sendRichText(chatId: string, text: string, images: string[], replyToId?: string): Promise<SendResult> {
    this.logger.info(`[FeishuChannel] sendRichText to ${chatId}, images=${images.length}`);
    try {
      // 上传图片获取 image_key
      const imageKeys: string[] = [];
      for (const imagePath of images) {
        this.logger.info(`[FeishuChannel] Uploading image: ${imagePath}`);
        const uploadResult = await uploadImage(this.client, imagePath);
        if (uploadResult.ok && uploadResult.imageKey) {
          imageKeys.push(uploadResult.imageKey);
          this.logger.info(`[FeishuChannel] Image uploaded: ${uploadResult.imageKey}`);
        } else {
          this.logger.error(`[FeishuChannel] Image upload failed: ${uploadResult.error}`);
        }
      }

      if (imageKeys.length === 0) {
        // 没有图片，降级为纯文本
        this.logger.info(`[FeishuChannel] No images uploaded, fallback to sendText`);
        return this.sendText(chatId, text, replyToId);
      }

      // 发送富文本消息
      const result = await sendRichTextMessage(this.client, chatId, text, imageKeys, replyToId);
      this.logger.info(`[FeishuChannel] sendRichText result: ok=${result.ok}`);
      return result;
    } catch (err) {
      this.logger.error(`[FeishuChannel] sendRichText error: ${(err as Error).message}`);
      return { ok: false, error: (err as Error).message };
    }
  }

  async sendFile(chatId: string, filePath: string, replyToId?: string): Promise<SendResult> {
    this.logger.info(`[FeishuChannel] sendFile to ${chatId}: ${filePath}`);
    try {
      const result = await uploadAndSendFile(
        this.client,
        filePath,
        chatId,
        replyToId || '',
        {
          info: (msg) => this.logger.info(`[Feishu] ${msg}`),
          error: (msg) => this.logger.error(`[Feishu] ${msg}`),
        }
      );
      this.logger.info(`[FeishuChannel] sendFile result: ok=${result.ok}`);
      return result;
    } catch (err) {
      this.logger.error(`[FeishuChannel] sendFile error: ${(err as Error).message}`);
      return { ok: false, error: (err as Error).message };
    }
  }

  // ============================================================
  // 额外方法（飞书特有，不在 IChannel 接口）
  // ============================================================

  async sendMedia(chatId: string, mediaUrl: string, text?: string) {
    return sendMediaMessage(this.client, chatId, mediaUrl, text);
  }

  /**
   * 上传图片（返回 imageKey）
   */
  async uploadImage(filePath: string) {
    return uploadImage(this.client, filePath);
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
        // 飞书事件转换为 StandardMessage
        const message: StandardMessage = {
          source: {
            channelId: this.id,
            chatId: event.chatId,
            userId: event.senderId,
            messageId: event.messageId,
            chatType: event.chatType,
          },
          content: { text: event.text },
        };
        await this.handleMessage(message);
      },
      onCardAction: this.hasInteractionHandler()
        ? async (event) => {
          // 飞书卡片事件转换为 InteractionEvent
          const value = event.action.value;
          
          // value 结构: { kind: 'button', action: 'opencode.question.reply', args: {...} }
          // 实际 action 应该从 value.action 获取，而不是 value.kind
          const action = (value.action as string) || (value.kind as string) || '';
          
          const interactionEvent: InteractionEvent = {
            channelId: this.id,
            chatId: '', // 飞书卡片事件不包含 chatId，需要从上下文获取
            userId: event.open_id || '',
            messageId: event.open_message_id,
            action,
            value,
          };
          return this.handleInteraction(interactionEvent);
        }
        : undefined,
    };

    const provider = startFeishuProvider(options);
    this.stopFn = provider.stop;

    this.markConnected();
    this.logger.info(`[Feishu] Mode: ${this.config.connectionMode || 'websocket'}`);
  }

  disconnect(): void {
    if (this.stopFn) {
      this.stopFn();
      this.stopFn = null;
    }
    this.markDisconnected();
  }
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建飞书 Channel
 */
export function createFeishuChannel(config: FeishuConfig, logger: Logger): FeishuChannel {
  return new FeishuChannel(config, logger);
}

// ============================================================
// 兼容性导出（逐步迁移）
// ============================================================

/**
 * @deprecated 使用 FeishuChannel 代替
 */
export const FeishuClient = FeishuChannel;

/**
 * @deprecated 使用 createFeishuChannel 代替
 */
export const createFeishuApiClient = createFeishuChannel;