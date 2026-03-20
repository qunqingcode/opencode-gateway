/**
 * 飞书 Channel 实现
 * 
 * 将 FeishuProvider 适配为 ChannelPlugin 接口
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
  MessageSource,
} from '../types';
import type { ChannelFactory } from '../types';
import { FeishuProvider, FeishuConfig } from '../../providers/feishu';

// ============================================================
// 飞书配置
// ============================================================

export interface FeishuChannelConfig extends ChannelConfig {
  type: 'feishu';
  /** 渠道名称 */
  name?: string;
  /** 飞书 App ID */
  appId: string;
  /** 飞书 App Secret */
  appSecret: string;
  /** 连接模式 */
  connectionMode?: 'websocket' | 'webhook';
  /** 域名 */
  domain?: 'feishu' | 'lark';
  /** Webhook 端口 */
  webhookPort?: number;
  /** Webhook 路径 */
  webhookPath?: string;
  /** 加密 Key */
  encryptKey?: string;
  /** 验证 Token */
  verificationToken?: string;
  /** 思考阈值 */
  thinkingThresholdMs?: number;
  /** 机器人名称 */
  botNames?: string[];
}

// ============================================================
// FeishuChannel 实现
// ============================================================

export class FeishuChannel implements ChannelPlugin {
  readonly id: string;
  readonly type = 'feishu' as const;
  readonly name: string;

  private provider: FeishuProvider;
  private logger: Logger;
  private messageHandler: MessageHandler | null = null;
  private interactionHandler: InteractionHandler | null = null;

  constructor(config: FeishuChannelConfig, logger: Logger) {
    this.id = config.id;
    this.name = config.name ?? 'Feishu';
    this.logger = logger;

    // 创建底层 Provider
    this.provider = new FeishuProvider({
      id: config.id,
      type: 'messenger',
      enabled: true,
      capabilities: ['messaging', 'media', 'notification'],
      name: config.name ?? 'Feishu',
      appId: config.appId,
      appSecret: config.appSecret,
      connectionMode: config.connectionMode,
      domain: config.domain,
      webhookPort: config.webhookPort,
      webhookPath: config.webhookPath,
      encryptKey: config.encryptKey,
      verificationToken: config.verificationToken,
      thinkingThresholdMs: config.thinkingThresholdMs,
      botNames: config.botNames,
    }, logger);
  }

  // ============================================================
  // Outbound Adapter
  // ============================================================

  readonly outbound: OutboundAdapter = {
    sendText: async (chatId, text, options) => {
      const result = await this.provider.sendText(chatId, text, options?.replyTo);
      return { ok: result.ok, messageId: result.messageId };
    },

    sendCard: async (chatId, card) => {
      if (!this.provider.sendCard) {
        return { ok: false };
      }
      const result = await this.provider.sendCard(chatId, card);
      return { ok: result.ok, messageId: result.messageId };
    },

    sendMedia: async (chatId, media, text) => {
      if (!this.provider.sendMedia) {
        return { ok: false };
      }
      const result = await this.provider.sendMedia(chatId, media.url, text);
      return { ok: result.ok, messageId: result.messageId };
    },
  };

  // ============================================================
  // Lifecycle Adapter
  // ============================================================

  readonly lifecycle: LifecycleAdapter = {
    start: async () => {
      await this.provider.initialize(this.logger);

      // ⚠️ 必须在 provider.start() 之前注册处理器
      // 因为 provider.start() 内部会检查 this.interactionHandler

      // 注册消息处理器
      this.provider.onMessage(async (event) => {
        if (this.messageHandler) {
          const message: StandardMessage = {
            source: {
              channelId: this.id,
              chatId: event.source.chatId,
              userId: event.source.senderId || '',
              messageId: event.source.messageId,
              chatType: event.source.chatType === 'direct' ? 'p2p' : 'group',
            },
            content: {
              text: event.content.text,
            },
            raw: event,
          };
          await this.messageHandler(message);
        }
      });

      // 注册交互处理器
      if (this.provider.onInteraction) {
        this.provider.onInteraction(async (event) => {
          if (this.interactionHandler) {
            // 从 value 中提取 chatId
            const value = event.value as Record<string, unknown>;
            const contextData = value?.context as Record<string, unknown> | undefined;
            const chatId = (contextData?.chatId as string) || '';
            
            return this.interactionHandler({
              channelId: this.id,
              userId: event.userId,
              chatId,
              messageId: event.messageId,
              action: event.action,
              value: event.value,
            });
          }
          return {};
        });
      }

      // 启动 provider（会在内部使用上面注册的 handler）
      await this.provider.start();
    },

    stop: async () => {
      await this.provider.destroy();
    },

    healthCheck: async () => {
      return this.provider.healthCheck();
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
  // Provider Access
  // ============================================================

  /**
   * 获取底层 FeishuProvider
   */
  getProvider(): FeishuProvider {
    return this.provider;
  }

  /**
   * 获取飞书客户端
   */
  getClient() {
    return this.provider.getClient();
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