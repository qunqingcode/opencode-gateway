/**
 * Flow 引擎入口
 * 
 * 导出类型、注册表、执行引擎
 */

import type { Logger } from '../types';
import type { ToolRegistry, ToolContext } from '../tools';
import type { IAgent } from '../agents';
import type { FlowTemplate, FlowEngineConfig, FlowRegistryConfig } from './types';
import { FlowRegistry } from './registry';
import { FlowEngine } from './engine';

// 类型导出
export type {
  FlowTemplate,
  FlowStep,
  FlowParamDef,
  FlowOutputDef,
  FlowExecution,
  FlowExecutionState,
  FlowRegistryConfig,
  FlowEngineConfig,
} from './types';

// 类导出
export { FlowRegistry } from './registry';
export { FlowEngine } from './engine';

// ============================================================
// Flow 管理器
// ============================================================

/**
 * Flow 管理器
 * 
 * 统一管理 Flow 注册表和执行引擎
 */
export class FlowManager {
  readonly registry: FlowRegistry;
  readonly engine: FlowEngine;

  constructor(
    toolRegistry: ToolRegistry,
    agent: IAgent,
    config: {
      templatesDir: string;
      engineConfig?: FlowEngineConfig;
    },
    logger: Logger
  ) {
    this.registry = new FlowRegistry(
      { templatesDir: config.templatesDir },
      logger
    );

    this.engine = new FlowEngine(
      toolRegistry,
      agent,
      logger,
      config.engineConfig
    );
  }

  /**
   * 初始化
   */
  async init(): Promise<void> {
    await this.registry.init();
  }

  /**
   * 执行 Flow
   */
  async execute(
    flowName: string,
    params: Record<string, unknown>,
    context: ToolContext
  ): Promise<{ success: boolean; output?: unknown; error?: string }> {
    const flow = this.registry.get(flowName);

    if (!flow) {
      return { success: false, error: `未找到工作流: ${flowName}` };
    }

    return await this.engine.execute(flow, params, context);
  }

  /**
   * 获取 Flow 描述（用于生成工具描述）
   */
  getFlowDescriptions(): string {
    return this.registry.getFlowDescriptions();
  }

  /**
   * 列出所有 Flow
   */
  listFlows(): FlowTemplate[] {
    return this.registry.list();
  }
}