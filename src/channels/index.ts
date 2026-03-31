/**
 * Channel 层导出
 * 
 * Channel = IM 渠道（有连接、有状态）
 * Client = API 客户端（无状态）
 */

// ============================================================
// 基类
// ============================================================

export { BaseChannel, type ChannelConnectionState } from './base';

// ============================================================
// 类型
// ============================================================

export type {
  IChannel,
  MessageHandler,
  InteractionHandler,
  StandardMessage,
  InteractionEvent,
  InteractionResult,
  SendResult,
} from './types';

// ============================================================
// 飞书 Channel
// ============================================================

export {
  // Channel 类
  FeishuChannel,
  createFeishuChannel,
  // 配置类型
  type FeishuConfig,
  
  // 发送功能
  createFeishuClient,
  sendTextMessage,
  sendMediaMessage,
  sendCardMessage,
  uploadAndSendFile,
  sendRichTextMessage,
  uploadImage,
  type FeishuSendResult,
  
  // 连接管理
  startFeishuProvider,
  type FeishuProviderOptions,
  
  // 卡片
  FeishuCardBuilder,
  ActionBuilder,
  createFeishuCardInteractionEnvelope,
  buildFeishuCardInteractionContext,
  decodeFeishuCardAction,
  FEISHU_CARD_DEFAULT_TTL_MS,
  type FeishuCard,
  type FeishuCardInteractionEnvelope,
  type DecodedFeishuCardAction,
} from './feishu';