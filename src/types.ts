/**
 * 统一类型定义
 * 
 * 所有模块共用的类型都在这里定义
 */

// ============================================================
// Logger
// ============================================================

export interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
}

// ============================================================
// Provider 类型
// ============================================================

/** Provider 能力标识 */
export type ProviderCapability =
  | 'messaging'
  | 'media'
  | 'issues'
  | 'repository'
  | 'wiki'
  | 'notification'
  | 'approval'
  | 'project';

/** Provider 类型 */
export type ProviderType = 'messenger' | 'vcs' | 'issue' | 'notification';

/** Provider 配置 */
export interface ProviderConfig {
  id: string;
  type: ProviderType;
  enabled: boolean;
  name?: string;
  capabilities: ProviderCapability[];
  [key: string]: unknown;
}

/** Provider 状态 */
export interface ProviderStatus {
  running: boolean;
  lastStartAt: number | null;
  lastStopAt: number | null;
  lastError: string | null;
  lastActivityAt: number | null;
  mode?: string;
}

// ============================================================
// 消息类型
// ============================================================

/** 消息来源 */
export interface MessageSource {
  provider: string;
  chatId: string;
  messageId: string;
  senderId: string;
  chatType: 'direct' | 'group';
  raw?: unknown;
}

/** 消息内容 */
export interface MessageContent {
  text?: string;
  richText?: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'file';
  metadata?: Record<string, unknown>;
}

/** 消息事件 */
export interface MessageEvent {
  source: MessageSource;
  content: MessageContent;
  timestamp: number;
}

// ============================================================
// 交互类型
// ============================================================

/** 交互动作 */
export type InteractionAction = string;

/** 交互事件 */
export interface InteractionEvent {
  provider: string;
  action: InteractionAction;
  value: Record<string, unknown>;
  messageId: string;
  userId: string;
  chatId?: string;
  raw?: unknown;
}

/** 交互结果 */
export interface InteractionResult {
  success: boolean;
  message?: string;
  data?: unknown;
}

// ============================================================
// 问题/Bug 类型
// ============================================================

/** 问题/工单 */
export interface Issue {
  id: string | number;
  title: string;
  description?: string;
  status: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  type?: 'bug' | 'feature' | 'task' | 'story';
  assignee?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** 问题查询 */
export interface IssueQuery {
  projectId?: string | number;
  status?: string;
  assignee?: string;
  type?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

/** 创建问题参数 */
export interface IssueCreateParams {
  title: string;
  description?: string;
  type?: string;
  priority?: string;
  assignee?: string;
  [key: string]: unknown;
}

// ============================================================
// Git 类型
// ============================================================

/** 合并请求 */
export interface MergeRequest {
  id: string | number;
  title: string;
  description?: string;
  status: 'open' | 'merged' | 'closed';
  sourceBranch: string;
  targetBranch: string;
  url: string;
  author?: string;
  createdAt?: string;
}

/** 分支 */
export interface Branch {
  name: string;
  lastCommit?: {
    id: string;
    message: string;
    author: string;
    date: string;
  };
  protected?: boolean;
}