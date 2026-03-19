/**
 * 核心模块导出
 */

// ============================================================
// 类型导出
// ============================================================

export type {
  ProviderCapability,
  ProviderType,
  ProviderStatus,
  ProviderConfig,
  MessageSource,
  MessageContent,
  MessageEvent,
  InteractionAction,
  InteractionEvent,
  Issue,
  IssueQuery,
  IssueCreateParams,
  MergeRequest,
  Branch,
  Logger,
  GatewayConfig,
} from './types';

// ============================================================
// Provider 接口和基类
// ============================================================

export type {
  IProvider,
  IMessengerProvider,
  IIssueProvider,
  IRepositoryProvider,
  INotificationProvider,
  ProviderFactory,
} from './provider';

export { BaseProvider } from './provider';

// ============================================================
// Registry
// ============================================================

export {
  registerProvider,
  registerProviders,
  createProvider,
  createMessengerProvider,
  createIssueProvider,
  createRepositoryProvider,
  getRegisteredProviders,
  getProviderType,
  getProviderCapabilities,
  hasProvider,
  getProvidersByType,
  getProvidersByCapability,
  isMessengerProvider,
  isIssueProvider,
  isRepositoryProvider,
  isNotificationProvider,
  ProviderManager,
} from './registry';

// ============================================================
// Context
// ============================================================

export { gatewayContext } from './context';

// ============================================================
// Request Registry
// ============================================================

export { requestRegistry } from './request-registry';

// ============================================================
// Queue
// ============================================================

export { enqueueMessage, setMessageHandler, getQueueStats } from './queue';
export type { MessageHandler } from './queue';