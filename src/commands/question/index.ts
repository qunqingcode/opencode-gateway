/**
 * 问题指令处理器
 * 
 * 职责：
 * 1. 构建问题确认卡片（通过 CardBuilder）
 * 2. 处理用户交互（回答/取消）
 */

import type {
  Command,
  CommandHandler,
  CommandContext,
  InteractionResult,
  InteractionEnvelope,
  QuestionPayload,
} from '../types';

// ============================================================
// 类型定义
// ============================================================

/** 问题指令 */
export type QuestionCommand = Command<QuestionPayload>;

// ============================================================
// 解析器
// ============================================================

/**
 * 问题请求通常不通过文本解析，而是从 OpenCode API 直接获取
 */
function parseQuestion(_text: string): QuestionCommand | null {
  // 问题请求不通过文本解析，返回 null
  return null;
}

/**
 * 从问题请求对象创建指令
 */
export function createQuestionCommand(question: QuestionPayload): QuestionCommand {
  return {
    type: 'question',
    id: question.id,
    payload: question,
  };
}

// ============================================================
// 卡片构建
// ============================================================

/**
 * 构建问题确认卡片
 */
async function buildQuestionCard(
  command: QuestionCommand,
  context: CommandContext
): Promise<unknown> {
  // 使用 CardBuilder 抽象
  return context.cardBuilder.buildQuestionCard(command.payload, {
    userId: context.userId,
    chatId: context.chatId,
  });
}

// ============================================================
// 交互处理
// ============================================================

/**
 * 处理问题交互
 */
async function handleQuestionInteraction(
  action: string,
  envelope: InteractionEnvelope,
  context: CommandContext
): Promise<InteractionResult> {
  if (!context.services) {
    return { toast: { type: 'error', content: '服务未配置' } };
  }

  const [, actionType, requestId] = action.split('.');

  if (actionType === 'answer') {
    const answer = envelope.value?.answer as string || envelope.value?.q as string || '';
    const success = await context.services.opencode.replyQuestion(requestId, [answer]);

    if (!success) {
      return { toast: { type: 'error', content: '回复失败' } };
    }

    const chatId = context.services.registry.getChatId(requestId);
    if (!chatId) {
      return { toast: { type: 'error', content: '无法获取会话信息' } };
    }

    const result = await context.services.opencode.continueAfterReply(chatId);

    if (result.type === 'response') {
      return { toast: { type: 'success', content: `已回复: ${answer}` } };
    }

    if (result.type === 'permission') {
      return {
        toast: { type: 'info', content: '需要权限确认' },
      };
    }

    if (result.type === 'question') {
      const q = result.data as QuestionPayload;
      return {
        toast: { type: 'info', content: '需要回复更多问题' },
        card: await context.cardBuilder.buildQuestionCard(q, {
          userId: context.userId,
          chatId: context.chatId,
        }),
      };
    }

    return { toast: { type: 'success', content: `已回复: ${answer}` } };
  }

  if (actionType === 'cancel') {
    const success = await context.services.opencode.rejectQuestion(requestId);
    return {
      toast: { type: 'info', content: success ? '已取消' : '取消失败' },
    };
  }

  return { toast: { type: 'info', content: '已处理' } };
}

// ============================================================
// 导出 Handler
// ============================================================

/**
 * 问题指令处理器
 */
export const questionHandler: CommandHandler<QuestionPayload> = {
  type: 'question',

  parse: parseQuestion,

  buildCard: buildQuestionCard,

  handleInteraction: handleQuestionInteraction,
};

export default questionHandler;