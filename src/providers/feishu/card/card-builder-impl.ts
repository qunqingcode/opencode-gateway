/**
 * 飞书卡片构建器
 * 
 * 实现 CardBuilder 接口，提供飞书平台的卡片构建能力
 */

import type {
  CardBuilder,
  CardContext,
  PermissionPayload,
  QuestionPayload,
  CodeChangePayload,
  StatusPayload,
} from '../../../commands/types';
import {
  createPermissionCard,
  createQuestionCard,
  createCodeChangeCard,
  createStatusCard,
  buildFeishuCardInteractionContext,
  FEISHU_CARD_DEFAULT_TTL_MS,
} from './index';

// ============================================================
// 飞书卡片构建器实现
// ============================================================

/**
 * 飞书卡片构建器
 */
export class FeishuCardBuilder implements CardBuilder {
  /**
   * 构建权限确认卡片
   */
  async buildPermissionCard(payload: PermissionPayload, context: CardContext): Promise<unknown> {
    const expiresAt = context.expiresAt ?? Date.now() + FEISHU_CARD_DEFAULT_TTL_MS;

    return createPermissionCard({
      operatorOpenId: context.userId,
      chatId: context.chatId,
      expiresAt,
      permission: {
        id: payload.id,
        type: payload.type,
        title: payload.title,
        pattern: payload.pattern,
        metadata: payload.metadata,
      },
    });
  }

  /**
   * 构建问题确认卡片
   */
  async buildQuestionCard(payload: QuestionPayload, context: CardContext): Promise<unknown> {
    const expiresAt = context.expiresAt ?? Date.now() + FEISHU_CARD_DEFAULT_TTL_MS;

    return createQuestionCard({
      operatorOpenId: context.userId,
      chatId: context.chatId,
      expiresAt,
      question: {
        id: payload.id,
        questions: payload.questions,
      },
    });
  }

  /**
   * 构建代码修改审批卡片
   */
  async buildCodeChangeCard(payload: CodeChangePayload, context: CardContext): Promise<unknown> {
    const expiresAt = context.expiresAt ?? Date.now() + FEISHU_CARD_DEFAULT_TTL_MS;

    return createCodeChangeCard({
      operatorOpenId: context.userId,
      chatId: context.chatId,
      expiresAt,
      branchName: payload.branchName,
      summary: payload.summary,
      files: payload.files,
      changelog: payload.changelog,
      docUrl: payload.docUrl,
    });
  }

  /**
   * 构建状态卡片
   */
  async buildStatusCard(payload: StatusPayload): Promise<unknown> {
    return createStatusCard({
      title: payload.title,
      status: payload.status,
      message: payload.message,
      details: payload.details,
    });
  }
}

// ============================================================
// 单例实例
// ============================================================

let feishuCardBuilderInstance: FeishuCardBuilder | null = null;

/**
 * 获取飞书卡片构建器实例
 */
export function getFeishuCardBuilder(): FeishuCardBuilder {
  if (!feishuCardBuilderInstance) {
    feishuCardBuilderInstance = new FeishuCardBuilder();
  }
  return feishuCardBuilderInstance;
}