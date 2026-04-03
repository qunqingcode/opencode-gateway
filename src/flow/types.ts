/**
 * Flow 引擎类型定义
 * 
 * Flow = 声明式工作流模板，由 Agent 调用，内部编排多个工具
 */

import type { ToolContext, ToolResult } from '../tools';

// ============================================================
// Flow 模板定义
// ============================================================

/** Flow 步骤 */
export interface FlowStep {
  /** 步骤 ID */
  id: string;
  /** 描述 */
  description?: string;
  /** 调用的工具名称 */
  tool?: string;
  /** Agent 调用（不调用工具，而是让 Agent 处理） */
  agent?: boolean;
  /** Agent 提示词（当 agent: true 时使用） */
  prompt?: string;
  /** 参数（支持变量替换） */
  params?: Record<string, unknown>;
  /** 是否需要审批 */
  requiresApproval?: boolean;
  /** 条件执行 */
  condition?: string;
  /** 失败时重试次数 */
  retry?: number;
  /** 超时时间（毫秒） */
  timeout?: number;
}

/** Flow 参数定义 */
export interface FlowParamDef {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  description?: string;
  default?: unknown;
}

/** Flow 输出定义 */
export interface FlowOutputDef {
  /** 输出模板 */
  template?: string;
  /** 输出类型 */
  type?: 'text' | 'card' | 'json';
}

/** Flow 模板 */
export interface FlowTemplate {
  /** Flow 名称 */
  name: string;
  /** 版本 */
  version?: string;
  /** 描述 */
  description?: string;
  /** 触发关键词 */
  triggers?: {
    keywords?: string[];
    patterns?: string[];
  };
  /** 参数定义 */
  params?: Record<string, FlowParamDef>;
  /** 执行步骤 */
  steps: FlowStep[];
  /** 输出定义 */
  output?: FlowOutputDef;
  /** 错误处理 */
  onError?: {
    strategy: 'continue' | 'abort' | 'rollback';
    steps?: string[];
  };
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

// ============================================================
// Flow 执行上下文
// ============================================================

/** Flow 执行状态 */
export type FlowExecutionState = 'pending' | 'running' | 'paused' | 'completed' | 'error';

/** Flow 执行上下文 */
export interface FlowExecution {
  /** Flow 模板 */
  flow: FlowTemplate;
  /** 输入参数 */
  params: Record<string, unknown>;
  /** 工具上下文 */
  context: ToolContext;
  /** 执行状态 */
  state: FlowExecutionState;
  /** 当前步骤索引 */
  stepIndex: number;
  /** 各步骤输出 */
  outputs: Record<string, unknown>;
  /** 错误信息 */
  error?: string;
  /** 审批 ID（如果暂停等待审批） */
  approvalId?: string;
  /** 已审批的步骤 ID 列表 */
  approvedSteps?: string[];
  /** 开始时间 */
  startTime?: number;
  /** 结束时间 */
  endTime?: number;
  /** 执行 ID（用于恢复） */
  executionId?: string;
}

/** 暂停的执行（用于审批恢复） */
export interface PausedExecution {
  /** 执行 ID */
  executionId: string;
  /** 执行上下文 */
  execution: FlowExecution;
  /** 暂停的步骤 ID */
  pausedAtStepId: string;
  /** 审批 ID */
  approvalId: string;
  /** Promise resolve */
  resolve: (result: ToolResult) => void;
  /** Promise reject */
  reject: (error: Error) => void;
  /** 过期时间 */
  expiresAt: number;
}

// ============================================================
// Flow 注册表配置
// ============================================================

/** Flow 注册表配置 */
export interface FlowRegistryConfig {
  /** 模板目录 */
  templatesDir: string;
  /** 是否允许用户自定义模板 */
  allowCustom?: boolean;
  /** 模板文件扩展名 */
  extensions?: string[];
}

// ============================================================
// Flow 引擎配置
// ============================================================

/** Flow 引擎配置 */
export interface FlowEngineConfig {
  /** 默认超时时间（毫秒） */
  defaultTimeout?: number;
  /** 默认重试次数 */
  defaultRetry?: number;
  /** 审批超时时间（毫秒） */
  approvalTimeout?: number;
}

// ============================================================
// 导出
// ============================================================

export type { ToolContext, ToolResult };