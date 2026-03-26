/**
 * 飞书 Channel 实现
 * 
 * 参考 OpenClaw 的 Channel Adapter 设计：
 * - 只做消息格式转换和路由规则
 * - 不依赖 Provider，直接使用 Client
 */

import type {
  ChannelPlugin,
  ChannelConfig,
  StandardMessage,
  MessageHandler,
  InteractionHandler,
  OutboundAdapter,
  LifecycleAdapter,
  Logger,
} from '../types';
import type { ChannelFactory } from '../types';
import {
  FeishuClient,
  createFeishuApiClient,
  type FeishuConfig,
} from '../../api/feishu';
import { sendRichTextMessage, uploadImage } from '../../api/feishu/send';

// ============================================================
// 飞书配置
// ============================================================

export interface FeishuChannelConfig extends ChannelConfig {
  type: 'feishu';
  name?: string;
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
// FeishuChannel 实现
// ============================================================

export class FeishuChannel implements ChannelPlugin {
  readonly id: string;
  readonly type = 'feishu' as const;
  readonly name: string;

  private client: FeishuClient;
  private logger: Logger;
  private messageHandler: MessageHandler | null = null;
  private interactionHandler: InteractionHandler | null = null;
  private _outbound: OutboundAdapter | null = null;

  constructor(config: FeishuChannelConfig, logger: Logger) {
    this.id = config.id;
    this.name = config.name ?? 'Feishu';
    this.logger = logger;

    // 创建底层 Client
    this.client = createFeishuApiClient({
      id: config.id,
      appId: config.appId,
      appSecret: config.appSecret,
      connectionMode: config.connectionMode,
      domain: config.domain,
      webhookPort: config.webhookPort,
      webhookPath: config.webhookPath,
      encryptKey: config.encryptKey,
      verificationToken: config.verificationToken,
      botNames: config.botNames,
    }, logger);

    // 初始化 outbound adapter
    this._outbound = {
      // ============================================================
      // 纯文本消息
      // ============================================================
      sendText: async (chatId: string, text: string, options?: { replyTo?: string }) => {
        this.logger.info(`[FeishuChannel] sendText to ${chatId}`);
        try {
          const result = await this.client.sendText(chatId, text, options?.replyTo);
          this.logger.info(`[FeishuChannel] sendText result: ok=${result.ok}`);
          return { ok: result.ok, messageId: result.messageId };
        } catch (err) {
          this.logger.error(`[FeishuChannel] sendText error: ${(err as Error).message}`);
          return { ok: false };
        }
      },

      // ============================================================
      // 富文本消息（文本 + 图片在一条消息里）
      // ============================================================
      sendRichText: async (chatId: string, text: string, images: string[], options?: { replyTo?: string }) => {
        this.logger.info(`[FeishuChannel] sendRichText to ${chatId}, images=${images.length}`);
        try {
          // 上传图片获取 image_key
          const imageKeys: string[] = [];
          for (const imagePath of images) {
            this.logger.info(`[FeishuChannel] Uploading image: ${imagePath}`);
            const uploadResult = await uploadImage(this.client.getNativeClient(), imagePath);
            if (uploadResult.ok && uploadResult.imageKey) {
              imageKeys.push(uploadResult.imageKey);
              this.logger.info(`[FeishuChannel] Image uploaded: ${uploadResult.imageKey}`);
            } else {
              this.logger.error(`[FeishuChannel] Image upload failed: ${uploadResult.error}`);
            }
          }

          if (imageKeys.length === 0) {
            // 没有图片，降级为纯文本
            this.logger.info(`[FeishuChannel] No images, fallback to sendText`);
            return await this._outbound!.sendText(chatId, text, options);
          }

          // 发送富文本消息
          const result = await sendRichTextMessage(
            this.client.getNativeClient(),
            chatId,
            text,
            imageKeys,
            options?.replyTo
          );
          this.logger.info(`[FeishuChannel] sendRichText result: ok=${result.ok}`);
          return { ok: result.ok, messageId: result.messageId };
        } catch (err) {
          this.logger.error(`[FeishuChannel] sendRichText error: ${(err as Error).message}`);
          return { ok: false };
        }
      },

      // ============================================================
      // 发送文件/图片（单独一条消息）
      // ============================================================
      sendFile: async (chatId: string, filePath: string, options?: { replyTo?: string }) => {
        this.logger.info(`[FeishuChannel] sendFile to ${chatId}: ${filePath}`);
        try {
          const result = await this.client.uploadAndSendFile(
            filePath,
            chatId,
            options?.replyTo
          );
          this.logger.info(`[FeishuChannel] sendFile result: ok=${result.ok}`);
          return { ok: result.ok, messageId: result.messageId };
        } catch (err) {
          this.logger.error(`[FeishuChannel] sendFile error: ${(err as Error).message}`);
          return { ok: false };
        }
      },

      // ============================================================
      // 卡片消息
      // ============================================================
      sendCard: async (chatId: string, card: unknown) => {
        this.logger.info(`[FeishuChannel] sendCard to ${chatId}`);
        try {
          const result = await this.client.sendCard(chatId, card);
          this.logger.info(`[FeishuChannel] sendCard result: ok=${result.ok}`);
          return { ok: result.ok, messageId: result.messageId };
        } catch (err) {
          this.logger.error(`[FeishuChannel] sendCard error: ${(err as Error).message}`);
          return { ok: false };
        }
      },

      // ============================================================
      // 媒体消息
      // ============================================================
      sendMedia: async (chatId: string, media: { url: string }, text?: string) => {
        this.logger.info(`[FeishuChannel] sendMedia to ${chatId}`);
        try {
          const result = await this.client.sendMedia(chatId, media.url, text);
          return { ok: result.ok, messageId: result.messageId };
        } catch (err) {
          this.logger.error(`[FeishuChannel] sendMedia error: ${(err as Error).message}`);
          return { ok: false };
        }
      },
    };
  }

  // ============================================================
  // Outbound Adapter
  // ============================================================

  get outbound(): OutboundAdapter {
    return this._outbound!;
  }

  // ============================================================
  // Lifecycle Adapter
  // ============================================================

  readonly lifecycle: LifecycleAdapter = {
    start: async () => {
      // 注册消息处理器
      this.client.onMessage(async (event) => {
        if (this.messageHandler) {
          const message: StandardMessage = {
            source: {
              channelId: this.id,
              chatId: event.chatId,
              userId: event.senderId || '',
              messageId: event.messageId,
              chatType: event.chatType === 'p2p' ? 'p2p' : 'group',
            },
            content: {
              text: event.text,
            },
            raw: event,
          };
          await this.messageHandler(message);
        }
      });

      // 注册交互处理器
      this.client.onInteraction(async (event) => {
        if (this.interactionHandler) {
          const value = event.action?.value as Record<string, unknown> || {};
          const contextData = value?.context as Record<string, unknown> | undefined;
          const chatId = (contextData?.chatId as string) || '';
          
          return this.interactionHandler({
            channelId: this.id,
            userId: event.userId || '',
            chatId,
            messageId: event.open_message_id || '',
            action: (value?.action as string) || 'custom',
            value,
          });
        }
        return {};
      });

      // 连接
      await this.client.connect();
    },

    stop: async () => {
      this.client.disconnect();
    },

    healthCheck: async () => {
      return this.client.healthCheck();
    },
  };

  // ============================================================
  // Message Handler Registration
  // ============================================================

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onInteraction(handler: InteractionHandler): void {
    this.interactionHandler = handler;
  }

  // ============================================================
  // Client Access
  // ============================================================

  /**
   * 获取底层 Client
   */
  getClient(): FeishuClient {
    return this.client;
  }
}

// ============================================================
// Factory
// ============================================================

export const createFeishuChannel: ChannelFactory<FeishuChannelConfig> = (
  config,
  logger
) => {
  return new FeishuChannel(config, logger);
};

// 注册到全局 registry
import { registerChannel } from '../registry';
registerChannel('feishu', createFeishuChannel as ChannelFactory);