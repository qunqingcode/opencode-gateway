/**
 * Channel Registry
 * 
 * 独立的注册表模块，避免循环依赖
 */

import type { ChannelFactory } from './types';

const channelRegistry = new Map<string, ChannelFactory>();

/**
 * 注册渠道工厂
 */
export function registerChannel(type: string, factory: ChannelFactory): void {
  channelRegistry.set(type, factory);
}

/**
 * 获取注册表
 */
export function getChannelRegistry(): Map<string, ChannelFactory> {
  return channelRegistry;
}

/**
 * 获取已注册的渠道类型
 */
export function getRegisteredChannelTypes(): string[] {
  return Array.from(channelRegistry.keys());
}