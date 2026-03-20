/**
 * MCP Server 基础类
 * 
 * 提供工具注册和调用的通用实现
 */

import type { IMCPServer, ToolDefinition, ToolResult } from './types';
import type { MCPToolCallResult, ToolContext } from '../gateway/types';
import type { Logger } from '../channels/types';

/**
 * MCP Server 基础类
 */
export abstract class BaseMCPServer implements IMCPServer {
  readonly abstract name: string;
  readonly description?: string;

  protected tools = new Map<string, ToolDefinition>();
  protected logger: Logger;
  protected config: Record<string, unknown>;

  constructor(config: Record<string, unknown>, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  // ============================================================
  // 工具注册
  // ============================================================

  /**
   * 注册工具
   */
  protected registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
    this.logger.debug?.(`[${this.name}] Registered tool: ${tool.name}`);
  }

  /**
   * 批量注册工具
   */
  protected registerTools(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  // ============================================================
  // IMCPServer 接口实现
  // ============================================================

  listTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async callTool(name: string, args: Record<string, unknown>, context: ToolContext): Promise<MCPToolCallResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${name}`,
      };
    }

    try {
      const result = await tool.execute(args, context);
      return {
        success: result.success,
        output: result.output,
        error: result.error,
        requiresApproval: result.requiresApproval,
        approvalCard: result.approvalCard,
      };
    } catch (error) {
      this.logger.error(`[${this.name}] Tool ${name} failed: ${(error as Error).message}`);
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  async start(): Promise<void> {
    // 子类可以覆盖此方法进行初始化
    this.logger.info(`[${this.name}] MCP Server started`);
  }

  async stop(): Promise<void> {
    // 子类可以覆盖此方法进行清理
    this.logger.info(`[${this.name}] MCP Server stopped`);
  }
}