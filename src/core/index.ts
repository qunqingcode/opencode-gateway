/**
 * 核心模块导出
 */

// 类型导出
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

// Provider 接口和基类导出
export type {
  IProvider,
  IMessengerProvider,
  IIssueProvider,
  IRepositoryProvider,
  INotificationProvider,
  ProviderFactory,
} from './provider';

export { BaseProvider } from './provider';

// Registry 导出
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