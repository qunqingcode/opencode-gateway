/**
 * 指令层模块
 * 
 * 统一管理所有业务指令的生命周期：
 * - 解析：从 AI 响应中提取指令
 * - 卡片：构建审批/交互卡片
 * - 交互：处理用户操作
 * 
 * 架构定位：
 * Provider = 能力提供者（怎么做）
 * Command = 业务指令（做什么）
 * Orchestrator = 调度器（什么时候做）
 */

// ============================================================
// 核心导出
// ============================================================

export { CommandPipeline, getCommandPipeline, resetCommandPipeline } from './pipeline';

export type {
  Command,
  CommandHandler,
  CommandContext,
  CommandResult,
  CommandType,
  InteractionResult,
  InteractionEnvelope,
  SendCardFunction,
  // Payload 类型
  PermissionPayload,
  QuestionPayload,
  CodeChangePayload,
  StatusPayload,
  QuestionItem,
  // 抽象接口
  CardBuilder,
  CardContext,
  CommandServices,
} from './types';

// ============================================================
// 指令处理器导出
// ============================================================

// Code Change
export {
  codeChangeHandler,
  type CodeChangeCommand,
} from './code-change';

// Permission
export {
  permissionHandler,
  createPermissionCommand,
  type PermissionCommand,
} from './permission';

// Question
export {
  questionHandler,
  createQuestionCommand,
  type QuestionCommand,
} from './question';

// ============================================================
// 初始化函数
// ============================================================

import { getCommandPipeline } from './pipeline';
import { codeChangeHandler } from './code-change';
import { permissionHandler } from './permission';
import { questionHandler } from './question';
import type { CardBuilder, CommandServices } from './types';

/**
 * 初始化指令层
 * 
 * @param cardBuilder 卡片构建器（必须）
 * @param services 服务依赖（必须）
 */
export function setupCommands(cardBuilder: CardBuilder, services: CommandServices): void {
  const pipeline = getCommandPipeline();

  // 配置卡片构建器和服务依赖
  pipeline.setCardBuilder(cardBuilder);
  pipeline.setServices(services);

  // 注册所有处理器
  pipeline
    .register(codeChangeHandler)
    .register(permissionHandler)
    .register(questionHandler);

  console.log('[Commands] Setup complete:', pipeline.getRegisteredTypes().join(', '));
}

/**
 * 获取已注册的指令类型列表
 */
export function getRegisteredCommandTypes(): string[] {
  return getCommandPipeline().getRegisteredTypes();
}