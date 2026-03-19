/**
 * 指令层类型定义
 * 
 * Command = 业务指令的抽象
 * CommandHandler = 指令处理器的统一接口
 * CardBuilder = 卡片构建抽象（支持多平台）
 * CommandServices = 服务依赖注入
 */

import type { IMessengerProvider } from '../core';

// ============================================================
// 核心类型
// ============================================================

/** 指令类型标识 */
export type CommandType = 'permission' | 'question' | 'code_change';

/** 指令基础接口 */
export interface Command<T = unknown> {
  /** 指令类型 */
  type: CommandType;
  /** 指令唯一 ID */
  id: string;
  /** 指令负载数据 */
  payload: T;
}

/** 指令处理结果 */
export interface CommandResult {
  /** 结果类型 */
  type: 'response' | 'command' | 'error';
  /** 结果数据 */
  data?: unknown;
  /** 错误信息 */
  error?: string;
}

/** 卡片交互结果 */
export interface InteractionResult {
  /** Toast 提示 */
  toast?: {
    type: 'success' | 'error' | 'info' | 'warning';
    content: string;
  };
  /** 更新的卡片 */
  card?: unknown;
}

/** 交互信封 - 从卡片交互中解析的数据 */
export interface InteractionEnvelope {
  /** 动作类型 */
  action: string;
  /** 动作值 */
  value: Record<string, unknown>;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

// ============================================================
// Payload 类型定义
// ============================================================

/** 权限请求负载 */
export interface PermissionPayload {
  id: string;
  type: string;
  title?: string;
  pattern?: string | string[];
  metadata?: {
    path?: string;
    command?: string;
    url?: string;
    query?: string;
  };
}

/** 问题项 */
export interface QuestionItem {
  question: string;
  options?: string[];
}

/** 问题请求负载 */
export interface QuestionPayload {
  id: string;
  questions: QuestionItem[];
}

/** 代码修改请求负载 */
export interface CodeChangePayload {
  branchName: string;
  summary: string;
  changelog?: string;
  files: string[];
  docUrl?: string;
}

/** 状态卡片负载 */
export interface StatusPayload {
  title: string;
  status: 'success' | 'error' | 'warning' | 'info';
  message: string;
  details?: string;
}

// ============================================================
// CardBuilder 接口 - 抽象卡片构建
// ============================================================

/**
 * 卡片构建器接口
 * 
 * 抽象卡片构建逻辑，支持不同平台（飞书、钉钉、企微等）
 * Command 层只依赖此接口，不关心具体实现
 */
export interface CardBuilder {
  /**
   * 构建权限确认卡片
   */
  buildPermissionCard(payload: PermissionPayload, context: CardContext): Promise<unknown>;

  /**
   * 构建问题确认卡片
   */
  buildQuestionCard(payload: QuestionPayload, context: CardContext): Promise<unknown>;

  /**
   * 构建代码修改审批卡片
   */
  buildCodeChangeCard(payload: CodeChangePayload, context: CardContext): Promise<unknown>;

  /**
   * 构建状态卡片
   */
  buildStatusCard(payload: StatusPayload): Promise<unknown>;
}

/** 卡片上下文 - 构建卡片所需的元数据 */
export interface CardContext {
  /** 用户 ID */
  userId: string;
  /** 聊天 ID */
  chatId: string;
  /** 过期时间 */
  expiresAt?: number;
}

// ============================================================
// CommandServices 接口 - 统一服务依赖注入
// ============================================================

/**
 * 指令服务接口
 * 
 * 统一管理所有 Command 需要的外部服务依赖
 * 通过依赖注入方式提供，便于测试和替换实现
 */
export interface CommandServices {
  /** OpenCode 相关服务 */
  opencode: {
    /** 回复权限请求 */
    replyPermission(requestId: string, reply: 'once' | 'always' | 'reject'): Promise<boolean>;
    /** 回复问题 */
    replyQuestion(requestId: string, answers: string[]): Promise<boolean>;
    /** 拒绝问题 */
    rejectQuestion(requestId: string): Promise<boolean>;
    /** 继续处理（权限/问题回复后） */
    continueAfterReply(chatId: string): Promise<{ type: string; data: unknown }>;
  };

  /** 请求注册表服务 */
  registry: {
    /** 获取聊天 ID */
    getChatId(requestId: string): string | undefined;
  };

  /** 代码仓库服务（可选） */
  repository?: {
    /** 创建 MR */
    createMergeRequest(sourceBranch: string, targetBranch: string, title: string): Promise<{ url: string }>;
  };
}

// ============================================================
// CommandContext - 指令执行上下文
// ============================================================

/**
 * 指令上下文
 * 
 * 包含处理指令所需的所有依赖和元数据
 */
export interface CommandContext {
  /** 聊天 ID */
  chatId: string;
  /** 发送者 ID */
  userId: string;
  /** 消息 ID */
  messageId: string;
  /** 消息发送者 */
  senderId?: string;
  /** 卡片构建器 */
  cardBuilder: CardBuilder;
  /** 消息发送能力 */
  messenger: {
    sendText(chatId: string, text: string, replyToId?: string): Promise<void>;
    sendCard?(chatId: string, card: unknown): Promise<void>;
  };
  /** 服务依赖（可选，部分指令需要） */
  services?: CommandServices;
}

// ============================================================
// CommandHandler 接口
// ============================================================

/**
 * 指令处理器接口
 * 
 * 每种指令类型实现此接口，定义完整的生命周期：
 * 1. parse: 从 AI 响应中解析指令
 * 2. buildCard: 构建审批/交互卡片
 * 3. handleInteraction: 处理用户交互
 */
export interface CommandHandler<TPayload = unknown> {
  /** 指令类型标识 */
  readonly type: CommandType;

  /**
   * 从 AI 响应文本中解析指令
   * @param text AI 响应文本
   * @returns 解析出的指令，或 null 表示无此类型指令
   */
  parse(text: string): Command<TPayload> | null;

  /**
   * 构建审批/交互卡片
   * @param command 指令对象
   * @param context 指令上下文
   * @returns 卡片数据
   */
  buildCard(command: Command<TPayload>, context: CommandContext): Promise<unknown>;

  /**
   * 处理用户交互
   * @param action 动作类型（如 'code_change.create_mr'）
   * @param envelope 交互信封
   * @param context 指令上下文
   * @returns 交互结果
   */
  handleInteraction(
    action: string,
    envelope: InteractionEnvelope,
    context: CommandContext
  ): Promise<InteractionResult>;
}

// ============================================================
// 工具函数类型
// ============================================================

/** 发送卡片的通用函数 */
export type SendCardFunction = (
  chatId: string,
  card: unknown,
  requestId: string,
  meta: { senderId: string; messageId: string }
) => Promise<void>;