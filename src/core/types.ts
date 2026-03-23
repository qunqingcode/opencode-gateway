/**
 * 核心类型定义
 * 
 * 所有 Provider 和模块共用的类型
 */

// ============================================================
// Provider 类型
// ============================================================

/** Provider 能力标识 */
export type ProviderCapability =
  | 'messaging'      // 消息收发
  | 'media'          // 媒体处理
  | 'issues'         // 问题跟踪
  | 'repository'     // 代码仓库
  | 'wiki'           // 文档/Wiki
  | 'notification'   // 通知推送
  | 'approval'       // 审批流程
  | 'project';       // 项目管理

/** Provider 类型 */
export type ProviderType =
  | 'messenger'      // 即时通讯（飞书、钉钉、企微）
  | 'vcs'            // 版本控制（GitLab、GitHub、Gitee）
  | 'issue'          // 问题跟踪（禅道、Jira）
  | 'notification';  // 通知服务（邮件、短信）

/** Provider 状态 */
export interface ProviderStatus {
  /** 是否运行中 */
  running: boolean;
  /** 最后启动时间 */
  lastStartAt: number | null;
  /** 最后停止时间 */
  lastStopAt: number | null;
  /** 最后错误 */
  lastError: string | null;
  /** 最后活动时间 */
  lastActivityAt: number | null;
  /** 连接模式 */
  mode?: string;
  /** 扩展信息 */
  [key: string]: unknown;
}

/** Provider 配置基础接口 */
export interface ProviderConfig {
  /** Provider ID */
  id: string;
  /** Provider 类型 */
  type: ProviderType;
  /** 是否启用 */
  enabled: boolean;
  /** 显示名称 */
  name?: string;
  /** 能力列表 */
  capabilities: ProviderCapability[];
}

// ============================================================
// 消息类型
// ============================================================

/** 消息来源 */
export interface MessageSource {
  /** 来源平台 */
  provider: string;
  /** 聊天 ID */
  chatId: string;
  /** 消息 ID */
  messageId: string;
  /** 发送者 ID */
  senderId: string;
  /** 聊天类型 */
  chatType: 'direct' | 'group';
  /** 原始数据 */
  raw?: unknown;
}

/** 消息内容 */
export interface MessageContent {
  /** 文本内容 */
  text?: string;
  /** 富文本内容 */
  richText?: string;
  /** 媒体 URL */
  mediaUrl?: string;
  /** 媒体类型 */
  mediaType?: 'image' | 'video' | 'audio' | 'file';
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/** 消息事件 */
export interface MessageEvent {
  /** 来源信息 */
  source: MessageSource;
  /** 消息内容 */
  content: MessageContent;
  /** 时间戳 */
  timestamp: number;
}

// ============================================================
// 卡片交互
// ============================================================

/** 交互动作类型 */
export type InteractionAction =
  | 'approve'        // 批准
  | 'reject'         // 拒绝
  | 'select'         // 选择
  | 'input'          // 输入
  | 'custom'         // 自定义
  | `permission.${string}`   // 权限操作
  | `question.${string}`     // 问题操作
  | (string & {});    // 支持任意字符串

/** 交互事件 */
export interface InteractionEvent {
  /** 来源平台 */
  provider: string;
  /** 动作类型 */
  action: InteractionAction;
  /** 动作值 */
  value: Record<string, unknown>;
  /** 消息 ID */
  messageId: string;
  /** 用户 ID */
  userId: string;
  /** 聊天 ID */
  chatId?: string;
  /** 原始数据 */
  raw?: unknown;
}

// ============================================================
// 问题/工单类型（禅道、Jira 等）
// ============================================================

/** 问题/工单 */
export interface Issue {
  /** 问题 ID */
  id: string | number;
  /** 标题 */
  title: string;
  /** 描述 */
  description?: string;
  /** 状态 */
  status: string;
  /** 优先级 */
  priority?: 'critical' | 'high' | 'medium' | 'low';
  /** 类型 */
  type?: 'bug' | 'feature' | 'task' | 'story';
  /** 指派人 */
  assignee?: string;
  /** 创建时间 */
  createdAt?: string;
  /** 更新时间 */
  updatedAt?: string;
  /** 扩展字段 */
  [key: string]: unknown;
}

/** 问题查询参数 */
export interface IssueQuery {
  /** 项目 ID */
  projectId?: string | number;
  /** 状态 */
  status?: string;
  /** 指派人 */
  assignee?: string;
  /** 类型 */
  type?: string;
  /** 关键词 */
  keyword?: string;
  /** 分页 */
  page?: number;
  pageSize?: number;
}

/** 问题创建参数 */
export interface IssueCreateParams {
  /** 标题 */
  title: string;
  /** 描述 */
  description?: string;
  /** 类型 */
  type?: string;
  /** 优先级 */
  priority?: string;
  /** 指派人 */
  assignee?: string;
  /** 扩展字段 */
  [key: string]: unknown;
}

// ============================================================
// 代码仓库类型（GitLab、GitHub 等）
// ============================================================

/** 合并请求 */
export interface MergeRequest {
  /** MR ID */
  id: string | number;
  /** 标题 */
  title: string;
  /** 描述 */
  description?: string;
  /** 状态 */
  status: 'open' | 'merged' | 'closed';
  /** 源分支 */
  sourceBranch: string;
  /** 目标分支 */
  targetBranch: string;
  /** URL */
  url: string;
  /** 作者 */
  author?: string;
  /** 创建时间 */
  createdAt?: string;
}

/** 分支信息 */
export interface Branch {
  /** 分支名 */
  name: string;
  /** 最后提交 */
  lastCommit?: {
    id: string;
    message: string;
    author: string;
    date: string;
  };
  /** 是否受保护 */
  protected?: boolean;
}

// ============================================================
// 日志接口
// ============================================================

export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  warn?(msg: string, ...args: unknown[]): void;
  debug?(msg: string, ...args: unknown[]): void;
}

// ============================================================
// 配置接口
// ============================================================

export interface GatewayConfig {
  /** Provider 配置 */
  providers: Record<string, ProviderConfig>;
  /** OpenCode 配置 */
  opencode: {
    url: string;
    timeout: number;
    modelId?: string;
    providerId?: string;
    /** 进度通知配置 */
    progress?: {
      /** 是否启用进度通知（默认 false，只保证不卡死） */
      enabled?: boolean;
      /** 是否推送工具执行状态（默认 false） */
      showToolStatus?: boolean;
      /** 是否推送文本输出（默认 false） */
      showTextOutput?: boolean;
    };
  };
  /** 队列配置 */
  queue: {
    maxCacheSize: number;
  };
}