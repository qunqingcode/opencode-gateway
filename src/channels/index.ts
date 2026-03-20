/**
 * Channels 层模块
 * 
 * 职责：
 * 1. 定义统一的渠道接口
 * 2. 管理渠道注册和发现
 * 3. 提供标准化消息格式
 */

// ============================================================
// 类型导出
// ============================================================

export type {
  ChannelType,
  MessageSource,
  StandardMessage,
  MediaPayload,
  CardAction,
  ApprovalCard,
  OutboundAdapter,
  AuthAdapter,
  SecurityAdapter,
  LifecycleAdapter,
  ChannelPlugin,
  MessageHandler,
  InteractionHandler,
  InteractionEvent,
  InteractionResult,
  ChannelConfig,
  ChannelFactory,
  Logger,
} from './types';

// ============================================================
// Registry 导出
// ============================================================

export { registerChannel, getChannelRegistry, getRegisteredChannelTypes } from './registry';

// ============================================================
// Channel 创建
// ============================================================

import type { ChannelPlugin, ChannelConfig, Logger } from './types';
import { getChannelRegistry } from './registry';

/**
 * 创建渠道实例
 */
export function createChannel(config: ChannelConfig, logger: Logger): ChannelPlugin | null {
  const registry = getChannelRegistry();
  const factory = registry.get(config.type);
  if (!factory) {
    logger.warn(`Unknown channel type: ${config.type}`);
    return null;
  }
  return factory(config, logger);
}

// ============================================================
// 消息格式化工具
// ============================================================

/**
 * 格式化消息来源字符串
 */
export function formatMessageSource(source: import('./types').MessageSource): string {
  return `[${source.channelType}] chat=${source.chatId}, user=${source.userId}`;
}

/**
 * 创建标准化消息
 */
export function createStandardMessage(
  source: import('./types').MessageSource,
  text: string,
  raw?: unknown
): import('./types').StandardMessage {
  return {
    source,
    content: { text },
    raw,
  };
}

// ============================================================
// 导入所有 Channel 实现，触发自动注册
// 必须放在最后，确保 registry 已经导出
// ============================================================

import './feishu';