/**
 * 飞书卡片模块
 * 
 * 提供飞书原生格式卡片构建能力
 */

// ============================================================
// 核心构建器
// ============================================================

export {
  FeishuCardBuilder,
  ActionBuilder,
  buildFeishuCardButton,
  createTextCard,
  createConfirmCard,
  createListCard,
  type FeishuCard,
  type CardElement,
  type CardAction,
} from "./card-builder.js";

// ============================================================
// 交互协议
// ============================================================

export {
  createFeishuCardInteractionEnvelope,
  buildFeishuCardInteractionContext,
  decodeFeishuCardAction,
  FEISHU_CARD_INTERACTION_VERSION,
  FEISHU_CARD_DEFAULT_TTL_MS,
  FEISHU_APPROVAL_REQUEST_ACTION,
  FEISHU_APPROVAL_CONFIRM_ACTION,
  FEISHU_APPROVAL_CANCEL_ACTION,
  FEISHU_QUICK_ACTION_HELP,
  FEISHU_QUICK_ACTION_NEW_SESSION,
  FEISHU_QUICK_ACTION_RESET,
  type FeishuCardInteractionEnvelope,
  type FeishuCardActionEvent as FeishuCardActionEventType,
  type DecodedFeishuCardAction,
  type FeishuCardInteractionKind,
  type FeishuCardInteractionReason,
} from "./card-interaction.js";

// ============================================================
// 类型定义
// ============================================================

export type {
  PermissionPayload,
  QuestionItem,
  QuestionPayload,
  CodeChangePayload,
  StatusPayload,
  ZentaoActionType,
  ZentaoPayload,
  ZentaoIssue,
  CardContext,
} from './types.js';