/**
 * 飞书 Provider 实现
 * 
 * 功能：
 * - 消息收发
 * - 卡片交互
 * - 多种卡片模板
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import {
  BaseProvider,
  IMessengerProvider,
  ProviderConfig,
  ProviderCapability,
  MessageEvent,
  InteractionEvent,
  Logger,
} from '../../core';
import { sendTextMessage, sendMediaMessage, sendCardMessage, createFeishuClient, uploadAndSendFile } from './send';
import { startFeishuProvider, FeishuProviderOptions } from './receive';

// 导出卡片模块
export {
  // 卡片交互协议
  createFeishuCardInteractionEnvelope,
  buildFeishuCardInteractionContext,
  decodeFeishuCardAction,
  FEISHU_CARD_DEFAULT_TTL_MS,
  FEISHU_APPROVAL_REQUEST_ACTION,
  FEISHU_APPROVAL_CONFIRM_ACTION,
  FEISHU_APPROVAL_CANCEL_ACTION,

  // 卡片构建器
  FeishuCardBuilder,
  ActionBuilder,
  buildFeishuCardButton,
  createTextCard,
  createConfirmCard,
  createListCard,

  // 卡片 UX 组件
  createApprovalCard,
  createQuickActionLauncherCard,
  createPermissionCard,
  createQuestionCard,
  createCodeChangeCard,
  createStatusCard,
  createThinkingCard,

  // 卡片动作处理器
  createCardActionHandler,
  type FeishuCardActionEvent,
  type CardActionCallbacks,
  type CardActionResult,
  type ContinueResult,
  type CardActionLogger,

  // 类型
  type FeishuCard,
  type FeishuCardInteractionEnvelope,
  type DecodedFeishuCardAction,
  type CardContextParams,
  type ApprovalCardParams,
  type PermissionCardParams,
  type QuestionCardParams,
  type CodeChangeCardParams,
} from './card';

// 导出文件上传
export { uploadAndSendFile } from './send';

// ============================================================
// 飞书配置
// ============================================================

export interface FeishuConfig extends ProviderConfig {
  /** Provider ID */
  id: string;
  /** 显示名称 */
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
// 飞书 Provider
// ============================================================

export class FeishuProvider extends BaseProvider implements IMessengerProvider {
  readonly id: string;
  readonly type = 'messenger' as const;
  readonly name: string;
  readonly capabilities: ProviderCapability[] = ['messaging', 'media', 'notification'];

  readonly config: FeishuConfig;

  private client: InstanceType<typeof Lark.Client> | null = null;
  private messageHandler: ((event: MessageEvent) => Promise<void>) | null = null;
  private interactionHandler: ((event: InteractionEvent) => Promise<unknown>) | null = null;

  constructor(config: FeishuConfig, logger: Logger) {
    super();
    this.config = config;
    this.id = config.id;
    this.name = config.name || 'Feishu';
    this.logger = logger;
  }

  async initialize(logger: Logger): Promise<void> {
    await super.initialize(logger);

    // 创建客户端
    this.client = createFeishuClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      domain: this.config.domain,
    });

    this.logger?.info(`[${this.id}] Feishu client created`);
  }

  public getClient(): InstanceType<typeof Lark.Client> | null {
    return this.client;
  }

  async start(): Promise<{ stop: () => void }> {
    if (!this.client) {
      throw new Error('Provider not initialized');
    }

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
        thinkingThresholdMs: this.config.thinkingThresholdMs,
        botNames: this.config.botNames,
      },
      log: {
        info: (msg) => this.logger?.info(`[${this.id}] ${msg}`),
        error: (msg) => this.logger?.error(`[${this.id}] ${msg}`),
        warn: (msg) => this.logger?.warn?.(`[${this.id}] ${msg}`),
        debug: (msg) => this.logger?.debug?.(`[${this.id}] ${msg}`),
      },
      statusSink: (patch) => {
        Object.assign(this.status, patch);
      },
      onMessage: async (event) => {
        this.recordActivity();
        if (this.messageHandler) {
          await this.messageHandler({
            source: {
              provider: this.id,
              chatId: event.chatId,
              messageId: event.messageId,
              senderId: event.senderId,
              chatType: event.chatType === 'p2p' ? 'direct' : 'group',
            },
            content: {
              text: event.text,
            },
            timestamp: Date.now(),
          });
        }
      },
      onCardAction: this.interactionHandler
        ? async (event) => {
            this.recordActivity();
            return this.interactionHandler!({
              provider: this.id,
              action: 'custom',
              value: event.action.value as Record<string, unknown>,
              messageId: event.open_message_id,
              userId: event.open_id || '',
            });
          }
        : undefined,
    };

    const provider = startFeishuProvider(options);
    this.stopFn = provider.stop;

    this.setStatusRunning(this.config.connectionMode || 'websocket');
    this.logger?.info(`[${this.id}] Feishu provider started`);

    return { stop: () => this.destroy() };
  }

  async healthCheck(): Promise<{ healthy: boolean; message: string; details?: Record<string, unknown> }> {
    try {
      if (!this.client) {
        return { healthy: false, message: 'Client not initialized' };
      }

      return {
        healthy: true,
        message: 'Client initialized',
        details: {
          appId: this.config.appId,
          connectionMode: this.config.connectionMode,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        message: (error as Error).message,
      };
    }
  }

  // ============================================================
  // 消息发送
  // ============================================================

  async sendText(
    chatId: string,
    text: string,
    replyToId?: string
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    if (!this.client) {
      return { ok: false, error: 'Client not initialized' };
    }

    this.recordActivity();
    return sendTextMessage(this.client, chatId, text, replyToId);
  }

  async sendMedia(
    chatId: string,
    mediaUrl: string,
    text?: string
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    if (!this.client) {
      return { ok: false, error: 'Client not initialized' };
    }

    this.recordActivity();
    return sendMediaMessage(this.client, chatId, mediaUrl, text);
  }

  async sendCard(
    chatId: string,
    card: unknown,
    replyToId?: string
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    if (!this.client) {
      return { ok: false, error: 'Client not initialized' };
    }

    this.recordActivity();
    return sendCardMessage(this.client, chatId, card as object, replyToId);
  }

  // ============================================================
  // 事件处理
  // ============================================================

  onMessage(handler: (event: MessageEvent) => Promise<void>): void {
    this.messageHandler = handler;
  }

  onInteraction(handler: (event: InteractionEvent) => Promise<unknown>): void {
    this.interactionHandler = handler;
  }
}

// ============================================================
// 工厂函数
// ============================================================

export function createFeishuProvider(config: FeishuConfig, logger: Logger): FeishuProvider {
  return new FeishuProvider(config, logger);
}