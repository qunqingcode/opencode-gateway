/**
 * 工具基类
 */

import type { Logger } from '../types';
import type { ToolDefinition, ToolResult, ToolContext, ITool } from './types';

// ============================================================
// 工具基类
// ============================================================

/**
 * 工具基类
 * 
 * 提供通用方法，简化工具实现
 */
export abstract class BaseTool implements ITool {
  abstract readonly definition: ToolDefinition;

  protected logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  abstract execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;

  // ============================================================
  // 辅助方法
  // ============================================================

  /**
   * 返回成功结果
   */
  protected success(output: unknown): ToolResult {
    return { success: true, output };
  }

  /**
   * 返回错误结果
   */
  protected error(message: string): ToolResult {
    return { success: false, error: message };
  }

  /**
   * 返回需要审批的结果
   */
  protected needsApproval(card: unknown, message: string = '需要审批'): ToolResult {
    return {
      success: true,
      requiresApproval: true,
      output: message,
      card: card,
    };
  }
}