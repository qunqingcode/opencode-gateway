/**
 * Provider 基础接口
 * 
 * 所有平台 Provider 都需要实现这个接口
 * 支持飞书、GitLab、禅道、钉钉等平台的统一接入
 */

import {
  ProviderConfig,
  ProviderStatus,
  ProviderCapability,
  MessageEvent,
  InteractionEvent,
  Issue,
  IssueQuery,
  IssueCreateParams,
  MergeRequest,
  Branch,
  Logger,
} from './types';

// ============================================================
// Provider 基础接口
// ============================================================

/**
 * Provider 基础接口
 * 
 * 所有平台 Provider 必须实现的方法
 */
export interface IProvider {
  /** Provider ID */
  readonly id: string;

  /** Provider 类型 */
  readonly type: string;

  /** 显示名称 */
  readonly name: string;

  /** 能力列表 */
  readonly capabilities: ProviderCapability[];

  /** 配置 */
  readonly config: ProviderConfig;

  /**
   * 初始化 Provider
   */
  initialize(logger: Logger): Promise<void>;

  /**
   * 启动 Provider
   */
  start(): Promise<{ stop: () => void }>;

  /**
   * 获取状态
   */
  getStatus(): ProviderStatus;

  /**
   * 健康检查
   */
  healthCheck(): Promise<{ healthy: boolean; message: string; details?: Record<string, unknown> }>;

  /**
   * 销毁 Provider
   */
  destroy(): Promise<void>;
}

// ============================================================
// 消息 Provider 接口
// ============================================================

/**
 * 消息 Provider 接口
 * 
 * 用于飞书、钉钉、企业微信等即时通讯平台
 */
export interface IMessengerProvider extends IProvider {
  /**
   * 发送文本消息
   */
  sendText(chatId: string, text: string, replyToId?: string): Promise<{ ok: boolean; messageId?: string; error?: string }>;

  /**
   * 发送媒体消息
   */
  sendMedia?(chatId: string, mediaUrl: string, text?: string): Promise<{ ok: boolean; messageId?: string; error?: string }>;

  /**
   * 发送交互卡片
   */
  sendCard?(chatId: string, card: unknown): Promise<{ ok: boolean; messageId?: string; error?: string }>;

  /**
   * 注册消息处理器
   */
  onMessage(handler: (event: MessageEvent) => Promise<void>): void;

  /**
   * 注册交互处理器
   */
  onInteraction?(handler: (event: InteractionEvent) => Promise<unknown>): void;
}

// ============================================================
// 问题跟踪 Provider 接口
// ============================================================

/**
 * 问题跟踪 Provider 接口
 * 
 * 用于禅道、Jira、Trello 等问题跟踪平台
 */
export interface IIssueProvider extends IProvider {
  /**
   * 获取问题列表
   */
  getIssues(query: IssueQuery): Promise<{ issues: Issue[]; total: number }>;

  /**
   * 获取单个问题
   */
  getIssue(issueId: string | number): Promise<Issue | null>;

  /**
   * 创建问题
   */
  createIssue(params: IssueCreateParams): Promise<Issue>;

  /**
   * 更新问题
   */
  updateIssue?(issueId: string | number, params: Partial<IssueCreateParams>): Promise<Issue>;

  /**
   * 关闭问题
   */
  closeIssue?(issueId: string | number): Promise<void>;

  /**
   * 添加评论
   */
  addComment?(issueId: string | number, content: string): Promise<void>;
}

// ============================================================
// 代码仓库 Provider 接口
// ============================================================

/**
 * 代码仓库 Provider 接口
 * 
 * 用于 GitLab、GitHub、Gitee 等代码托管平台
 */
export interface IRepositoryProvider extends IProvider {
  /**
   * 获取分支列表
   */
  getBranches?(): Promise<Branch[]>;

  /**
   * 创建分支
   */
  createBranch?(name: string, ref?: string): Promise<Branch>;

  /**
   * 推送分支
   */
  pushBranch?(name: string): Promise<boolean>;

  /**
   * 获取 MR 列表
   */
  getMergeRequests?(state?: 'open' | 'merged' | 'closed'): Promise<MergeRequest[]>;

  /**
   * 创建 MR
   */
  createMergeRequest(sourceBranch: string, targetBranch: string, title: string): Promise<MergeRequest>;

  /**
   * 合并 MR
   */
  mergeMergeRequest?(mrId: string | number): Promise<MergeRequest>;

  /**
   * 关闭 MR
   */
  closeMergeRequest?(mrId: string | number): Promise<void>;
}

// ============================================================
// 通知 Provider 接口
// ============================================================

/**
 * 通知 Provider 接口
 * 
 * 用于邮件、短信、推送等通知服务
 */
export interface INotificationProvider extends IProvider {
  /**
   * 发送通知
   */
  send(to: string | string[], subject: string, content: string): Promise<{ ok: boolean; error?: string }>;

  /**
   * 发送模板通知
   */
  sendTemplate?(to: string | string[], templateId: string, params: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>;
}

// ============================================================
// Provider 工厂函数类型
// ============================================================

/**
 * Provider 工厂函数
 */
export type ProviderFactory<T extends IProvider = IProvider> = (config: ProviderConfig, logger: Logger) => T;

// ============================================================
// Provider 基类
// ============================================================

/**
 * Provider 基类
 * 
 * 提供通用的状态管理和日志功能
 */
export abstract class BaseProvider implements IProvider {
  abstract readonly id: string;
  abstract readonly type: string;
  abstract readonly name: string;
  abstract readonly capabilities: ProviderCapability[];
  abstract readonly config: ProviderConfig;

  protected logger: Logger | null = null;
  protected status: ProviderStatus = {
    running: false,
    lastStartAt: null,
    lastStopAt: null,
    lastError: null,
    lastActivityAt: null,
  };
  protected stopFn: (() => void) | null = null;

  async initialize(logger: Logger): Promise<void> {
    this.logger = logger;
    this.logger.info(`[${this.id}] Provider initialized`);
  }

  abstract start(): Promise<{ stop: () => void }>;

  getStatus(): ProviderStatus {
    return { ...this.status };
  }

  abstract healthCheck(): Promise<{ healthy: boolean; message: string; details?: Record<string, unknown> }>;

  async destroy(): Promise<void> {
    if (this.stopFn) {
      this.stopFn();
      this.stopFn = null;
    }
    this.status.running = false;
    this.status.lastStopAt = Date.now();
    this.logger?.info(`[${this.id}] Provider destroyed`);
  }

  protected setStatusRunning(mode?: string): void {
    this.status.running = true;
    this.status.lastStartAt = Date.now();
    this.status.lastError = null;
    if (mode) this.status.mode = mode;
  }

  protected setStatusStopped(): void {
    this.status.running = false;
    this.status.lastStopAt = Date.now();
  }

  protected setStatusError(error: string): void {
    this.status.lastError = error;
  }

  protected recordActivity(): void {
    this.status.lastActivityAt = Date.now();
  }
}