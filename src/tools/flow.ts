/**
 * Flow 执行工具
 * 
 * Agent 调用此工具执行预定义的工作流
 */

import type { Logger } from '../types';
import { BaseTool } from './base';
import type { ToolDefinition, ToolResult, ToolContext, ITool } from './types';
import type { FlowManager } from '../flow';

// ============================================================
// Flow 执行工具
// ============================================================

/**
 * 创建 Flow 执行工具
 * 
 * 根据已注册的 Flows 动态生成工具描述
 */
export function createFlowExecuteTool(
  flowManager: FlowManager,
  logger: Logger
): ITool {
  const flowDescriptions = flowManager.getFlowDescriptions();

  const definition: ToolDefinition = {
    name: 'flow.execute',
    description: `执行预定义的工作流。当用户请求复杂的多步骤操作时使用。

可用的工作流：
${flowDescriptions}

使用示例：
- 用户说"修复 Bug #123"时，调用：
  { "flowName": "bug-fix-workflow", "params": { "bugId": 123 } }
  
- 用户说"生成周报"时，调用：
  { "flowName": "weekly-report", "params": {} }`,
    inputSchema: {
      type: 'object',
      properties: {
        flowName: {
          type: 'string',
          description: '工作流名称',
        },
        params: {
          type: 'object',
          description: '工作流参数',
        },
      },
      required: ['flowName'],
    },
  };

  return {
    definition,

    async execute(
      args: Record<string, unknown>,
      context: ToolContext
    ): Promise<ToolResult> {
      const { flowName, params = {} } = args;

      logger.info(`[FlowExecuteTool] Executing: ${flowName}`);

      const result = await flowManager.execute(
        flowName as string,
        params as Record<string, unknown>,
        context
      );

      return result;
    },
  };
}