/**
 * Flow 执行引擎
 * 
 * 负责执行 Flow 模板，编排工具调用，处理审批和错误
 */

import type { Logger } from '../types';
import type { ToolRegistry, ToolResult, ToolContext } from '../tools';
import type { IAgent } from '../agents';
import type {
  FlowTemplate,
  FlowStep,
  FlowExecution,
  FlowEngineConfig,
  PausedExecution,
} from './types';
import { generateId } from '../utils';

// ============================================================
// Flow 执行引擎
// ============================================================

export class FlowEngine {
  private toolRegistry: ToolRegistry;
  private agent: IAgent;
  private logger: Logger;
  private config: FlowEngineConfig;

  // 暂停的执行（等待审批）
  private pausedExecutions = new Map<string, PausedExecution>();

  constructor(
    toolRegistry: ToolRegistry,
    agent: IAgent,
    logger: Logger,
    config?: FlowEngineConfig
  ) {
    this.toolRegistry = toolRegistry;
    this.agent = agent;
    this.logger = logger;
    this.config = {
      defaultTimeout: 300000, // 5 分钟
      defaultRetry: 0,
      approvalTimeout: 600000, // 10 分钟
      ...config,
    };
  }

  // ============================================================
  // 执行
  // ============================================================

  /**
   * 执行 Flow
   */
  async execute(
    flow: FlowTemplate,
    params: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const executionId = generateId();

    const execution: FlowExecution = {
      flow,
      params: this.resolveDefaults(flow, params),
      context,
      state: 'running',
      stepIndex: 0,
      outputs: {},
      executionId,
      approvedSteps: [],
      startTime: Date.now(),
    };

    this.logger.info(`[FlowEngine] Starting: ${flow.name} (${executionId})`);

    return this.executeFromStep(execution, 0);
  }

  /**
   * 从指定步骤开始执行
   */
  private async executeFromStep(execution: FlowExecution, startStepIndex: number): Promise<ToolResult> {
    const flow = execution.flow;

    try {
      // 验证参数
      if (startStepIndex === 0) {
        const validationError = this.validateParams(flow, execution.params);
        if (validationError) {
          return { success: false, error: validationError };
        }
      }

      // 逐步执行
      for (let i = startStepIndex; i < flow.steps.length; i++) {
        execution.stepIndex = i;
        const step = flow.steps[i];

        this.logger.info(`[FlowEngine] Step ${i + 1}/${flow.steps.length}: ${step.id}`);

        // 检查条件
        if (step.condition && !this.evaluateCondition(step.condition, execution)) {
          this.logger.info(`[FlowEngine] Step ${step.id} skipped (condition not met)`);
          continue;
        }

        // 执行步骤
        const output = await this.executeStep(step, execution);
        execution.outputs[step.id] = output;

        // 检查是否需要审批
        if (this.isApprovalRequest(output)) {
          const approvalResult = await this.handleApprovalRequest(output, step, execution);
          if (approvalResult.paused) {
            return approvalResult.result;
          }
          // 审批已自动处理，继续执行
          continue;
        }

        // 检查步骤是否失败
        if (this.isFailedResult(output)) {
          return this.handleStepError(step, output as ToolResult, execution);
        }
      }

      // 执行完成
      execution.state = 'completed';
      execution.endTime = Date.now();

      // 生成输出
      return this.generateOutput(flow, execution);
    } catch (error) {
      execution.state = 'error';
      execution.error = (error as Error).message;

      this.logger.error(`[FlowEngine] Error: ${(error as Error).message}`);

      return {
        success: false,
        error: `Flow 执行失败: ${(error as Error).message}`,
      };
    }
  }

  /**
   * 检查是否是审批请求
   */
  private isApprovalRequest(output: unknown): output is ToolResult & { requiresApproval: true; approvalData: NonNullable<ToolResult['approvalData']> } {
    return (
      output !== null &&
      typeof output === 'object' &&
      'requiresApproval' in output &&
      (output as ToolResult).requiresApproval === true &&
      'approvalData' in output &&
      typeof (output as ToolResult).approvalData === 'object'
    );
  }

  /**
   * 检查是否是失败结果
   */
  private isFailedResult(output: unknown): boolean {
    return (
      output !== null &&
      typeof output === 'object' &&
      'success' in output &&
      (output as ToolResult).success === false
    );
  }

  /**
   * 处理审批请求
   */
  private async handleApprovalRequest(
    output: ToolResult & { requiresApproval: true; approvalData: NonNullable<ToolResult['approvalData']> },
    step: FlowStep,
    execution: FlowExecution
  ): Promise<{ paused: boolean; result: ToolResult }> {
    const approvalId = generateId();

    // 暂停执行
    execution.state = 'paused';
    execution.approvalId = approvalId;

    // 保存暂停的执行
    const pausedExecution: PausedExecution = {
      executionId: execution.executionId!,
      execution,
      pausedAtStepId: step.id,
      approvalId,
      resolve: () => {},
      reject: () => {},
      expiresAt: Date.now() + this.config.approvalTimeout!,
    };

    this.pausedExecutions.set(execution.executionId!, pausedExecution);

    this.logger.info(`[FlowEngine] Paused at step ${step.id}, approvalId: ${approvalId}`);

    // 返回审批请求（由 ApprovalController 渲染卡片）
    return {
      paused: true,
      result: {
        success: true,
        requiresApproval: true,
        approvalData: output.approvalData,
        output: `等待审批: ${output.approvalData.summary}`,
      },
    };
  }

  // ============================================================
  // 恢复执行
  // ============================================================

  /**
   * 恢复审批后的执行
   * 
   * @param executionId 执行 ID
   * @param approved 是否通过审批
   */
  async resume(executionId: string, approved: boolean): Promise<ToolResult> {
    const paused = this.pausedExecutions.get(executionId);

    if (!paused) {
      return {
        success: false,
        error: '执行不存在或已过期',
      };
    }

    if (Date.now() > paused.expiresAt) {
      this.pausedExecutions.delete(executionId);
      return {
        success: false,
        error: '审批已过期',
      };
    }

    if (!approved) {
      // 用户拒绝
      this.pausedExecutions.delete(executionId);
      paused.execution.state = 'error';
      paused.execution.error = '用户取消';
      return {
        success: false,
        error: '用户取消操作',
      };
    }

    // 用户确认，继续执行
    this.logger.info(`[FlowEngine] Resuming: ${executionId}`);

    // 标记步骤已审批
    if (!paused.execution.approvedSteps) {
      paused.execution.approvedSteps = [];
    }
    paused.execution.approvedSteps.push(paused.pausedAtStepId);

    // 从下一步继续
    const nextStepIndex = paused.execution.stepIndex + 1;
    paused.execution.state = 'running';

    // 删除暂停记录
    this.pausedExecutions.delete(executionId);

    // 继续执行
    return this.executeFromStep(paused.execution, nextStepIndex);
  }

  /**
   * 获取暂停的执行
   */
  getPausedExecution(executionId: string): PausedExecution | undefined {
    return this.pausedExecutions.get(executionId);
  }

  /**
   * 根据 approvalId 查找暂停的执行
   */
  findPausedExecutionByApprovalId(approvalId: string): PausedExecution | undefined {
    for (const paused of this.pausedExecutions.values()) {
      if (paused.approvalId === approvalId) {
        return paused;
      }
    }
    return undefined;
  }

  /**
   * 执行单个步骤
   */
  private async executeStep(
    step: FlowStep,
    execution: FlowExecution
  ): Promise<unknown> {
    const retryCount = step.retry ?? this.config.defaultRetry ?? 0;
    const timeout = step.timeout ?? this.config.defaultTimeout!;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        if (step.tool) {
          // 调用工具
          const resolvedParams = this.resolveVariables(step.params || {}, execution) as Record<string, unknown>;

          // 告诉工具此步骤是否已被审批
          const isApproved = execution.approvedSteps?.includes(step.id) ?? false;

          const result = await this.executeWithTimeout(
            () => this.toolRegistry.execute(step.tool!, resolvedParams, {
              ...execution.context,
              approved: isApproved,  // 添加审批标记
            }),
            timeout
          );

          return result;
        }

        if (step.agent) {
          // 调用 Agent
          const prompt = this.resolveVariables(step.prompt || '', execution) as string;
          const sessionId = execution.context.sessionId;

          const response = await this.executeWithTimeout(
            () => this.agent.sendPrompt(sessionId, prompt),
            timeout
          );

          // 统一返回结构：包装为 output 字段（保持与 Tool 步骤一致）
          return { success: true, output: { response } };
        }

        throw new Error(`Step ${step.id} must have either tool or agent`);
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`[FlowEngine] Step ${step.id} attempt ${attempt + 1} failed: ${(error as Error).message}`);

        if (attempt < retryCount) {
          await this.sleep(1000 * (attempt + 1)); // 指数退避
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Unknown error',
    };
  }

  /**
   * 带超时执行
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout after ${timeout}ms`));
      }, timeout);

      fn()
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  // ============================================================
  // 变量解析
  // ============================================================

  /**
   * 解析变量
   * 
   * 支持 ${param} 和 ${step.output} 格式
   */
  private resolveVariables(
    value: unknown,
    execution: FlowExecution
  ): unknown {
    if (typeof value === 'string') {
      return value.replace(/\$\{([^}]+)\}/g, (_, path) => {
        return String(this.getNestedValue(execution, path));
      });
    }

    if (Array.isArray(value)) {
      return value.map(item => this.resolveVariables(item, execution));
    }

    if (typeof value === 'object' && value !== null) {
      const resolved: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        resolved[key] = this.resolveVariables(val, execution);
      }
      return resolved;
    }

    return value;
  }

  /**
   * 获取嵌套值（增强版）
   * 
   * 智能解析约定：
   * 1. ${get_bug.title} → 自动解析为 outputs.get_bug.output.title
   * 2. ${params.bugId} → 保持原样
   * 3. ${outputs.get_bug.output.title} → 保持原样（向后兼容）
   */
  private getNestedValue(obj: unknown, path: string): unknown {
    let parts = path.split('.');
    let current: unknown = obj;

    // ============================================================
    // 智能解析约定：自动添加前缀
    // ============================================================
    
    // 约定1：如果第一部分不是 params/outputs/flow，自动添加 outputs 前缀
    if (parts.length >= 1 && !['params', 'outputs', 'flow'].includes(parts[0])) {
      parts = ['outputs', ...parts];
    }

    // 约定2：如果是 outputs.stepId.field 格式，检查是否需要添加 output 前缀
    if (parts[0] === 'outputs' && parts.length >= 3) {
      const stepId = parts[1];
      const fieldAfterStepId = parts[2];
      
      // 检查 outputs 中是否有这个步骤
      if (typeof current === 'object' && current !== null && 'outputs' in current) {
        const outputs = (current as Record<string, unknown>).outputs;
        
        if (outputs && typeof outputs === 'object' && stepId in outputs) {
          const stepOutput = (outputs as Record<string, unknown>)[stepId];
          
          // 如果步骤输出有 output 字段（Tool 和 Agent 步骤都有），且访问的不是 output 本身
          if (
            stepOutput &&
            typeof stepOutput === 'object' &&
            'output' in stepOutput &&
            fieldAfterStepId !== 'output'
          ) {
            // 自动插入 'output' 前缀
            parts = ['outputs', stepId, 'output', ...parts.slice(2)];
          }
        }
      }
    }

    // ============================================================
    // 标准路径解析（原有逻辑）
    // ============================================================
    
    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }

      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  // ============================================================
  // 参数处理
  // ============================================================

  /**
   * 解析默认值
   */
  private resolveDefaults(
    flow: FlowTemplate,
    params: Record<string, unknown>
  ): Record<string, unknown> {
    const resolved = { ...params };

    if (flow.params) {
      for (const [key, def] of Object.entries(flow.params)) {
        if (resolved[key] === undefined && def.default !== undefined) {
          resolved[key] = def.default;
        }
      }
    }

    return resolved;
  }

  /**
   * 验证参数
   */
  private validateParams(
    flow: FlowTemplate,
    params: Record<string, unknown>
  ): string | null {
    if (!flow.params) {
      return null;
    }

    for (const [key, def] of Object.entries(flow.params)) {
      if (def.required && params[key] === undefined) {
        return `缺少必需参数: ${key}`;
      }

      if (params[key] !== undefined) {
        const actualType = Array.isArray(params[key]) ? 'array' : typeof params[key];
        if (actualType !== def.type) {
          return `参数 ${key} 类型错误: 期望 ${def.type}, 实际 ${actualType}`;
        }
      }
    }

    return null;
  }

  // ============================================================
  // 条件评估
  // ============================================================

  /**
   * 评估条件
   * 
   * 简单实现：支持 ${var} == "value" 格式
   */
  private evaluateCondition(condition: string, execution: FlowExecution): boolean {
    try {
      // 替换变量
      const resolved = this.resolveVariables(`\${${condition}}`, execution) as string;

      // 简单的相等判断
      if (resolved.includes('==')) {
        const [left, right] = resolved.split('==').map(s => s.trim());
        return left === right;
      }

      // 简单的真值判断
      return resolved === 'true' || resolved === '1';
    } catch {
      return false;
    }
  }

  // ============================================================
  // 错误处理
  // ============================================================

  /**
   * 处理步骤错误
   */
  private handleStepError(
    step: FlowStep,
    result: ToolResult,
    execution: FlowExecution
  ): ToolResult {
    const flow = execution.flow;

    if (flow.onError?.strategy === 'continue') {
      this.logger.warn(`[FlowEngine] Step ${step.id} failed, continuing...`);
      return { success: true, output: `步骤 ${step.id} 失败: ${result.error}` };
    }

    if (flow.onError?.strategy === 'rollback' && flow.onError.steps) {
      // TODO: 实现回滚逻辑
      this.logger.info(`[FlowEngine] Rolling back...`);
    }

    return {
      success: false,
      error: `步骤 ${step.id} 失败: ${result.error}`,
    };
  }

  // ============================================================
  // 输出生成
  // ============================================================

  /**
   * 生成输出
   */
  private generateOutput(flow: FlowTemplate, execution: FlowExecution): ToolResult {
    const outputDef = flow.output;

    if (!outputDef || !outputDef.template) {
      // 默认输出
      return {
        success: true,
        output: {
          flow: flow.name,
          outputs: execution.outputs,
          duration: execution.endTime! - execution.startTime!,
        },
      };
    }

    // 解析模板
    const output = this.resolveVariables(outputDef.template, execution);

    return {
      success: true,
      output,
    };
  }

  // ============================================================
  // 工具方法
  // ============================================================

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}