/**
 * 工具注册表
 * 
 * 管理所有工具的注册和调用
 */

import type { Logger } from '../types';
import type { ToolDefinition, ToolResult, ToolContext, ITool } from './types';

// ============================================================
// 工具注册表
// ============================================================

export class ToolRegistry {
  private tools = new Map<string, ITool>();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  // ============================================================
  // 注册
  // ============================================================

  /**
   * 注册工具
   */
  register(tool: ITool): void {
    const name = tool.definition.name;
    this.tools.set(name, tool);
    this.logger.info(`[ToolRegistry] Registered: ${name}`);
  }

  /**
   * 批量注册
   */
  registerAll(tools: ITool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * 注销工具
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  // ============================================================
  // 查询
  // ============================================================

  /**
   * 获取工具
   */
  get(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  /**
   * 检查工具是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 获取所有工具定义
   */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * 获取所有工具定义（排除内部工具）
   */
  listPublic(): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((t) => !t.definition.internal)
      .map((t) => t.definition);
  }

  /**
   * 获取工具名称列表
   */
  names(): string[] {
    return Array.from(this.tools.keys());
  }

  // ============================================================
  // 执行
  // ============================================================

  /**
   * 执行工具
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);

    if (!tool) {
      this.logger.warn(`[ToolRegistry] Tool not found: ${name}`);
      return { success: false, error: `Tool not found: ${name}` };
    }

    this.logger.info(`[ToolRegistry] Executing: ${name}`);

    try {
      const result = await tool.execute(args, context);
      this.logger.info(`[ToolRegistry] Result: ${name} - ${result.success ? 'success' : 'failed'}`);
      return result;
    } catch (error) {
      this.logger.error(`[ToolRegistry] Error: ${name} - ${(error as Error).message}`);
      return { success: false, error: (error as Error).message };
    }
  }

  // ============================================================
  // 生命周期
  // ============================================================

  /**
   * 启动所有工具
   */
  async startAll(): Promise<void> {
    for (const [name, tool] of this.tools) {
      if (tool.start) {
        try {
          await tool.start();
          this.logger.info(`[ToolRegistry] Started: ${name}`);
        } catch (error) {
          this.logger.error(`[ToolRegistry] Start failed: ${name} - ${(error as Error).message}`);
        }
      }
    }
  }

  /**
   * 停止所有工具
   */
  async stopAll(): Promise<void> {
    for (const [name, tool] of this.tools) {
      if (tool.stop) {
        try {
          await tool.stop();
          this.logger.info(`[ToolRegistry] Stopped: ${name}`);
        } catch (error) {
          this.logger.error(`[ToolRegistry] Stop failed: ${name} - ${(error as Error).message}`);
        }
      }
    }
  }
}