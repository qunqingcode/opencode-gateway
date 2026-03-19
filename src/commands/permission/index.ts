/**
 * 权限指令处理器
 * 
 * 职责：
 * 1. 构建权限确认卡片（通过 CardBuilder）
 * 2. 处理用户交互（允许一次/总是允许/拒绝）
 */

import type {
  Command,
  CommandHandler,
  CommandContext,
  InteractionResult,
  InteractionEnvelope,
  PermissionPayload,
} from '../types';

// ============================================================
// 类型定义
// ============================================================

/** 权限指令 */
export type PermissionCommand = Command<PermissionPayload>;

// ============================================================
// 解析器
// ============================================================

/**
 * 权限请求通常不通过文本解析，而是从 OpenCode API 直接获取
 * 这里提供一个占位实现
 */
function parsePermission(_text: string): PermissionCommand | null {
  // 权限请求不通过文本解析，返回 null
  // 实际的权限数据来自 OpenCode Provider 的 getPendingPermissions()
  return null;
}

/**
 * 从权限请求对象创建指令
 */
export function createPermissionCommand(permission: PermissionPayload): PermissionCommand {
  return {
    type: 'permission',
    id: permission.id,
    payload: permission,
  };
}

// ============================================================
// 卡片构建
// ============================================================

/**
 * 构建权限确认卡片
 */
async function buildPermissionCard(
  command: PermissionCommand,
  context: CommandContext
): Promise<unknown> {
  // 使用 CardBuilder 抽象
  return context.cardBuilder.buildPermissionCard(command.payload, {
    userId: context.userId,
    chatId: context.chatId,
  });
}

// ============================================================
// 交互处理
// ============================================================

/**
 * 处理权限交互
 */
async function handlePermissionInteraction(
  action: string,
  envelope: InteractionEnvelope,
  context: CommandContext
): Promise<InteractionResult> {
  if (!context.services) {
    return { toast: { type: 'error', content: '服务未配置' } };
  }

  const [, replyType, requestId] = action.split('.');
  const reply = replyType as 'once' | 'always' | 'reject';

  const success = await context.services.opencode.replyPermission(requestId, reply);

  if (!success) {
    return { toast: { type: 'error', content: '处理权限失败' } };
  }

  const chatId = context.services.registry.getChatId(requestId);
  if (!chatId) {
    return { toast: { type: 'error', content: '无法获取会话信息' } };
  }

  const result = await context.services.opencode.continueAfterReply(chatId);

  // 根据后续结果返回对应的响应
  if (result.type === 'response') {
    return { toast: { type: 'success', content: `已${reply === 'reject' ? '拒绝' : '批准'}权限请求` } };
  }

  if (result.type === 'permission') {
    const perm = result.data as PermissionPayload;
    return {
      toast: { type: 'info', content: '需要更多权限确认' },
      card: await context.cardBuilder.buildPermissionCard(perm, {
        userId: context.userId,
        chatId: context.chatId,
      }),
    };
  }

  if (result.type === 'question') {
    return {
      toast: { type: 'info', content: '需要回复问题' },
      // question 卡片由 question handler 处理
    };
  }

  return { toast: { type: 'success', content: `已${reply === 'reject' ? '拒绝' : '批准'}权限请求` } };
}

// ============================================================
// 导出 Handler
// ============================================================

/**
 * 权限指令处理器
 */
export const permissionHandler: CommandHandler<PermissionPayload> = {
  type: 'permission',

  parse: parsePermission,

  buildCard: buildPermissionCard,

  handleInteraction: handlePermissionInteraction,
};

export default permissionHandler;