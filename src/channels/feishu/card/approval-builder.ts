/**
 * 审批卡片构建器
 *
 * 统一处理工具审批卡片的构建，减少重复代码
 */

import { FeishuCardBuilder, ActionBuilder } from './card-builder';
import { createFeishuCardInteractionEnvelope, buildFeishuCardInteractionContext, type FeishuCardInteractionArgs } from './card-interaction';

// ============================================================
// 类型定义
// ============================================================

export interface ApprovalCardOptions {
  /** 卡片标题 */
  title: string;
  /** 卡片内容（Markdown） */
  content: string;
  /** 确认按钮文本 */
  confirmLabel?: string;
  /** 取消按钮文本 */
  cancelLabel?: string;
  /** 确认动作名称 */
  confirmAction: string;
  /** 取消动作名称 */
  cancelAction?: string;
  /** 传递给确认动作的参数 */
  args: FeishuCardInteractionArgs;
  /** 卡片颜色模板 */
  template?: string;
  /** 操作者 openId */
  operatorOpenId: string;
  /** 聊天 ID */
  chatId: string;
  /** 过期时间（毫秒，默认 5 分钟） */
  ttl?: number;
}

// ============================================================
// 审批卡片构建器
// ============================================================

/**
 * 创建审批卡片
 *
 * @param options 审批卡片选项
 * @returns 构建好的卡片
 */
export function createApprovalCard(options: ApprovalCardOptions) {
  const {
    title,
    content,
    confirmLabel = '确认',
    cancelLabel = '取消',
    confirmAction,
    cancelAction = 'workflow.cancel',
    args,
    template = 'blue',
    operatorOpenId,
    chatId,
    ttl = 300000,
  } = options;

  const cardContext = buildFeishuCardInteractionContext({
    operatorOpenId,
    chatId,
    expiresAt: Date.now() + ttl,
  });

  const confirmEnvelope = createFeishuCardInteractionEnvelope({
    kind: 'button',
    action: confirmAction,
    args,
    context: cardContext,
  });

  const cancelEnvelope = createFeishuCardInteractionEnvelope({
    kind: 'button',
    action: cancelAction,
    context: cardContext,
  });

  return new FeishuCardBuilder()
    .setConfig({ wide_screen_mode: true, update_multi: true })
    .setHeader(title, template)
    .addMarkdown(content)
    .addActionRow(
      new ActionBuilder()
        .addPrimaryButton(confirmLabel, confirmEnvelope)
        .addDefaultButton(cancelLabel, cancelEnvelope)
        .build()
    )
    .build();
}

/**
 * 创建成功结果卡片
 *
 * @param title 标题
 * @param content 内容
 * @returns 构建好的卡片
 */
export function createSuccessCard(title: string, content: string) {
  return new FeishuCardBuilder()
    .setConfig({ wide_screen_mode: true, update_multi: true })
    .setHeader(title, 'green')
    .addMarkdown(content)
    .build();
}

/**
 * 创建失败结果卡片
 *
 * @param title 标题
 * @param errorMessage 错误消息
 * @returns 构建好的卡片
 */
export function createErrorCard(title: string, errorMessage: string) {
  return new FeishuCardBuilder()
    .setConfig({ wide_screen_mode: true, update_multi: true })
    .setHeader(title, 'red')
    .addMarkdown(`**错误**: ${errorMessage}`)
    .build();
}

/**
 * 创建部分成功/失败的结果卡片
 *
 * @param title 标题
 * @param results 结果列表
 * @param allSuccess 是否全部成功
 * @returns 构建好的卡片
 */
export function createResultCard(
  title: string,
  results: Array<{ step: string; status: string; message: string }>,
  allSuccess: boolean
) {
  return new FeishuCardBuilder()
    .setConfig({ wide_screen_mode: true, update_multi: true })
    .setHeader(title, allSuccess ? 'green' : 'orange')
    .addMarkdown(
      results
        .map((r) => `${r.status === 'success' ? '✅' : '❌'} ${r.step}: ${r.message}`)
        .join('\n')
    )
    .build();
}