/**
 * 飞书卡片动作处理器
 * 
 * 处理飞书交互卡片的按钮点击事件
 * 支持权限确认、问题回复、代码修改审批等场景
 */

import { decodeFeishuCardAction, FeishuCardInteractionEnvelope } from './card-interaction';
import { createPermissionCard, createQuestionCard, createStatusCard, PermissionCardParams, QuestionCardParams } from './index';
import type { MergeRequest } from '../../../core/types';

// ============================================================
// 类型定义
// ============================================================

/** 卡片动作事件 */
export interface FeishuCardActionEvent {
  provider: string;
  action: string;
  value: Record<string, unknown>;
  messageId: string;
  userId: string;
}

/** 卡片动作回调接口 */
export interface CardActionCallbacks {
  replyPermission(requestId: string, reply: 'once' | 'always' | 'reject'): Promise<boolean>;
  replyQuestion(requestId: string, answers: string[]): Promise<boolean>;
  rejectQuestion(requestId: string): Promise<boolean>;
  continueAfterReply(chatId: string): Promise<ContinueResult>;
  createMR?(sourceBranch: string, targetBranch: string, title: string): Promise<MergeRequest>;
  getChatId(requestId: string): string;
}

/** 继续处理结果 */
export interface ContinueResult {
  type: 'response' | 'permission' | 'question' | 'code_change';
  data: unknown;
}

/** 卡片动作处理器结果 */
export interface CardActionResult {
  toast?: { type: 'success' | 'error' | 'info'; content: string };
  card?: unknown;
}

/** Logger 接口 */
export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
}

// ============================================================
// 通用函数
// ============================================================

/**
 * 处理 continueAfterReply 的后续结果
 * 
 * 抽取公共逻辑：根据 result.type 返回对应的卡片或 toast
 */
function handleContinueResult(
  result: ContinueResult,
  userId: string,
  chatId: string,
  successMessage: string
): CardActionResult {
  if (result.type === 'response') {
    return { toast: { type: 'success', content: successMessage } };
  }

  if (result.type === 'permission') {
    const perm = result.data as PermissionCardParams['permission'];
    return {
      toast: { type: 'info', content: '需要更多权限确认' },
      card: createPermissionCard({ operatorOpenId: userId, chatId, permission: perm }),
    };
  }

  if (result.type === 'question') {
    const q = result.data as QuestionCardParams['question'];
    return {
      toast: { type: 'info', content: '需要回复问题' },
      card: createQuestionCard({ operatorOpenId: userId, chatId, question: q }),
    };
  }

  return { toast: { type: 'success', content: successMessage } };
}

// ============================================================
// 处理器实现
// ============================================================

/**
 * 创建卡片动作处理器
 */
export function createCardActionHandler(
  callbacks: CardActionCallbacks,
  logger: Logger
) {
  return async function handleCardAction(event: FeishuCardActionEvent): Promise<CardActionResult> {
    logger.info(`[CardAction] action=${event.action} userId=${event.userId}`);

    const decoded = decodeFeishuCardAction({
      event: {
        operator: { open_id: event.userId },
        action: { value: event.value },
        context: {},
      },
    });

    if (decoded.kind === 'invalid') {
      logger.warn(`[CardAction] Invalid: ${decoded.reason}`);
      return { toast: { type: 'error', content: '操作无效或已过期' } };
    }

    if (decoded.kind === 'legacy') {
      logger.info(`[CardAction] Legacy: ${decoded.text}`);
      return { toast: { type: 'info', content: '已收到' } };
    }

    const envelope = decoded.envelope;
    const action = envelope.a;

    if (action.startsWith('permission.')) {
      return handlePermissionAction(action, envelope, event, callbacks, logger);
    }

    if (action.startsWith('question.')) {
      return handleQuestionAction(action, envelope, event, callbacks, logger);
    }

    if (action.startsWith('code_change.')) {
      return handleCodeChangeAction(action, envelope, callbacks, logger);
    }

    return { toast: { type: 'info', content: '已处理' } };
  };
}

// ============================================================
// 权限动作处理
// ============================================================

async function handlePermissionAction(
  action: string,
  envelope: FeishuCardInteractionEnvelope,
  event: FeishuCardActionEvent,
  callbacks: CardActionCallbacks,
  logger: Logger
): Promise<CardActionResult> {
  const [, replyType, requestId] = action.split('.');
  logger.info(`[Permission] reply=${replyType} requestId=${requestId}`);

  const reply = replyType as 'once' | 'always' | 'reject';
  const success = await callbacks.replyPermission(requestId, reply);

  if (!success) {
    return { toast: { type: 'error', content: '处理权限失败' } };
  }

  const chatId = callbacks.getChatId(requestId);
  const result = await callbacks.continueAfterReply(chatId);

  return handleContinueResult(
    result,
    event.userId,
    chatId,
    `已${reply === 'reject' ? '拒绝' : '批准'}权限请求`
  );
}

// ============================================================
// 问题动作处理
// ============================================================

async function handleQuestionAction(
  action: string,
  envelope: FeishuCardInteractionEnvelope,
  event: FeishuCardActionEvent,
  callbacks: CardActionCallbacks,
  logger: Logger
): Promise<CardActionResult> {
  const [, actionType, requestId] = action.split('.');
  logger.info(`[Question] action=${actionType} requestId=${requestId}`);

  if (actionType === 'answer') {
    const answer = envelope.q as string;
    const success = await callbacks.replyQuestion(requestId, [answer]);

    if (!success) {
      return { toast: { type: 'error', content: '回复失败' } };
    }

    const chatId = callbacks.getChatId(requestId);
    const result = await callbacks.continueAfterReply(chatId);

    return handleContinueResult(result, event.userId, chatId, `已回复: ${answer}`);
  }

  if (actionType === 'cancel') {
    const success = await callbacks.rejectQuestion(requestId);
    return { toast: { type: 'info', content: success ? '已取消' : '取消失败' } };
  }

  return { toast: { type: 'info', content: '已处理' } };
}

// ============================================================
// 代码修改动作处理
// ============================================================

async function handleCodeChangeAction(
  action: string,
  envelope: FeishuCardInteractionEnvelope,
  callbacks: CardActionCallbacks,
  logger: Logger
): Promise<CardActionResult> {
  const [, actionType] = action.split('.');
  const branchName = (envelope.m as Record<string, string>)?.branch || (envelope.q as string) || '';

  logger.info(`[CodeChange] action=${actionType} branch=${branchName}`);

  if (actionType === 'create_mr') {
    if (!callbacks.createMR) {
      return { toast: { type: 'error', content: 'GitLab 未配置' } };
    }

    try {
      const sourceBranch = branchName || `ai-change-${Date.now()}`;
      const targetBranch = 'develop';
      const mr = await callbacks.createMR(sourceBranch, targetBranch, `AI 代码修改: ${sourceBranch}`);

      logger.info(`[CodeChange] MR created: ${mr.url}`);

      return {
        toast: { type: 'success', content: 'MR 创建成功' },
        card: createStatusCard({
          title: '✅ MR 创建成功',
          status: 'success',
          message: '已创建 Merge Request',
          details: `[查看 MR](${mr.url})\n\n分支: \`${sourceBranch}\` → \`${targetBranch}\``,
        }),
      };
    } catch (error) {
      logger.error(`[CodeChange] Failed to create MR: ${(error as Error).message}`);
      return { toast: { type: 'error', content: `创建 MR 失败: ${(error as Error).message}` } };
    }
  }

  if (actionType === 'reject') {
    return {
      toast: { type: 'info', content: '已打回' },
      card: createStatusCard({
        title: '⚠️ 已打回',
        status: 'warning',
        message: '代码修改已被打回',
        details: branchName ? `分支 \`${branchName}\` 已保留，可手动处理` : '修改已取消',
      }),
    };
  }

  return { toast: { type: 'info', content: '已处理' } };
}