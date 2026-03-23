/**
 * API 模块入口
 * 
 * 导出所有 API Client：
 * - FeishuClient: 飞书 API
 * - GitLabClient: GitLab API
 * - ZentaoClient: 禅道 API
 */

// ============================================================
// Base
// ============================================================

export { BaseClient } from './base';

// ============================================================
// Feishu
// ============================================================

export {
  FeishuClient,
  createFeishuApiClient,
  type FeishuConfig,
  
  // 消息发送
  sendTextMessage,
  sendMediaMessage,
  sendCardMessage,
  
  // 卡片构建
  FeishuCardBuilder,
  ActionBuilder,
  createTextCard,
  createConfirmCard,
  createListCard,
  
  // 卡片交互
  createFeishuCardInteractionEnvelope,
  buildFeishuCardInteractionContext,
  decodeFeishuCardAction,
} from './feishu';

// ============================================================
// GitLab
// ============================================================

export {
  GitLabClient,
  createGitLabClient,
  type GitLabClientConfig,
} from './gitlab';

// ============================================================
// Zentao
// ============================================================

export {
  ZentaoClient,
  createZentaoClient,
  type ZentaoClientConfig,
} from './zentao';