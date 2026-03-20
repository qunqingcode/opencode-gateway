/**
 * 核心模块导出
 * 
 * 提供 Provider 基础接口和类型定义
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
} from './provider';

export { BaseProvider } from './provider';