/**
 * Cron MCP Server
 * 
 * 提供 AI 可调用的定时任务管理工具
 */

import { BaseMCPServer } from '../base';
import { createTool, ToolDefinition } from '../types';
import type { ToolContext } from '../../gateway/types';
import type { Logger } from '../../channels/types';
import {
  CronStore,
  CronScheduler,
  CronJob,
  CronExecutor,
  generateCronId,
  validateCronJob,
  cronExprToHuman,
} from '../../core/cron';
import type { CronLanguage } from '../../core/cron';

// ============================================================
// 配置
// ============================================================

export interface CronMCPServerConfig {
  /** 数据目录 */
  dataDir?: string;
  /** 默认语言 */
  defaultLanguage?: CronLanguage;
  /** 是否需要审批创建/删除任务 */
  requireApproval?: boolean;
}

// ============================================================
// Cron MCP Server 实现
// ============================================================

export class CronMCPServer extends BaseMCPServer implements CronExecutor {
  readonly name = 'cron';
  readonly description = '定时任务管理工具';

  private cronStore: CronStore;
  private scheduler: CronScheduler;
  private cronConfig: CronMCPServerConfig;
  private executorCallback?: (job: CronJob) => Promise<void>;

  constructor(config: CronMCPServerConfig, logger: Logger) {
    super(config as unknown as Record<string, unknown>, logger);
    this.cronConfig = config;
    
    // 初始化 Cron 存储
    this.cronStore = new CronStore(config.dataDir || './data', logger);
    
    // 初始化调度器
    this.scheduler = new CronScheduler(this.cronStore, logger);
    this.scheduler.registerExecutor('default', this);
    
    this.registerTools(this.createTools());
  }

  /**
   * 设置任务执行回调
   * 用于将任务执行转发给 AI Agent
   */
  setExecutorCallback(callback: (job: CronJob) => Promise<void>): void {
    this.executorCallback = callback;
  }

  /**
   * CronExecutor 接口实现
   */
  async executeCronJob(job: CronJob): Promise<void> {
    if (this.executorCallback) {
      await this.executorCallback(job);
    } else {
      this.logger.warn(`[CronMCP] No executor callback set for job: ${job.id}`);
    }
  }

  // ============================================================
  // 生命周期
  // ============================================================

  async start(): Promise<void> {
    await this.scheduler.start();
    await super.start();
  }

  async stop(): Promise<void> {
    this.scheduler.stop();
    await super.stop();
  }

  // ============================================================
  // 工具定义
  // ============================================================

  private createTools(): ToolDefinition[] {
    const requireApproval = this.cronConfig.requireApproval;
    const defaultLanguage = this.cronConfig.defaultLanguage || 'zh';
    
    return [
      // ========== 添加定时任务 ==========
      createTool({
        name: 'add',
        description: '添加定时任务。支持标准 cron 表达式（5字段：分 时 日 月 周）。',
        inputSchema: {
          type: 'object',
          properties: {
            cron_expr: {
              type: 'string',
              description: 'Cron 表达式，如 "0 9 * * *" 表示每天 9:00',
            },
            prompt: {
              type: 'string',
              description: '要执行的提示词/任务描述',
            },
            description: {
              type: 'string',
              description: '任务描述（可选）',
            },
            session_mode: {
              type: 'string',
              description: 'Session 模式: "reuse" 复用现有会话，"new_per_run" 每次新建会话',
              enum: ['reuse', 'new_per_run'],
            },
            timeout_mins: {
              type: 'number',
              description: '超时时间（分钟），默认 30，0 表示无限制',
            },
            silent: {
              type: 'boolean',
              description: '是否静默执行（不发送开始通知）',
            },
          },
          required: ['cron_expr', 'prompt'],
        },
        requiresApproval: requireApproval,
        execute: async (args, context) => {
          const cronExpr = args.cron_expr as string;
          const prompt = args.prompt as string;
          
          // 验证 cron 表达式
          const cron = await import('node-cron');
          if (!cron.validate(cronExpr)) {
            return { success: false, error: `无效的 cron 表达式: ${cronExpr}` };
          }

          const job: CronJob = {
            id: generateCronId(),
            project: 'default',
            sessionKey: context.chatId,
            cronExpr,
            prompt,
            description: (args.description as string) || prompt.slice(0, 50),
            enabled: true,
            mute: false,
            createdAt: Date.now(),
            sessionMode: args.session_mode as string,
            timeoutMins: args.timeout_mins as number,
            silent: args.silent as boolean,
          };

          // 验证任务
          const error = validateCronJob(job);
          if (error) {
            return { success: false, error };
          }

          const addError = await this.scheduler.addJob(job);
          if (addError) {
            return { success: false, error: addError };
          }

          const humanReadable = cronExprToHuman(cronExpr, defaultLanguage);
          
          return {
            success: true,
            output: {
              id: job.id,
              cron_expr: cronExpr,
              human_readable: humanReadable,
              message: `定时任务已创建: ${humanReadable}`,
            },
          };
        },
      }),

      // ========== 列出定时任务 ==========
      createTool({
        name: 'list',
        description: '列出所有定时任务',
        inputSchema: {
          type: 'object',
          properties: {
            enabled: {
              type: 'boolean',
              description: '筛选启用状态',
            },
          },
        },
        execute: async (args) => {
          let jobs = this.cronStore.list();
          
          if (args.enabled !== undefined) {
            jobs = jobs.filter(j => j.enabled === args.enabled);
          }

          const result = jobs.map(job => ({
            id: job.id,
            cron_expr: job.cronExpr,
            human_readable: cronExprToHuman(job.cronExpr, defaultLanguage),
            prompt: job.prompt.slice(0, 100) + (job.prompt.length > 100 ? '...' : ''),
            description: job.description,
            enabled: job.enabled,
            mute: job.mute,
            last_run: job.lastRun ? new Date(job.lastRun).toISOString() : null,
            last_error: job.lastError,
            created_at: new Date(job.createdAt).toISOString(),
          }));

          return {
            success: true,
            output: {
              total: result.length,
              jobs: result,
            },
          };
        },
      }),

      // ========== 删除定时任务 ==========
      createTool({
        name: 'remove',
        description: '删除定时任务',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: '任务 ID',
            },
          },
          required: ['id'],
        },
        requiresApproval: requireApproval,
        execute: async (args) => {
          const id = args.id as string;
          const removed = this.scheduler.removeJob(id);
          
          if (!removed) {
            return { success: false, error: `任务不存在: ${id}` };
          }

          return {
            success: true,
            output: { message: `任务已删除: ${id}` },
          };
        },
      }),

      // ========== 启用定时任务 ==========
      createTool({
        name: 'enable',
        description: '启用定时任务',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: '任务 ID',
            },
          },
          required: ['id'],
        },
        execute: async (args) => {
          const id = args.id as string;
          const error = await this.scheduler.enableJob(id);
          
          if (error) {
            return { success: false, error };
          }

          return {
            success: true,
            output: { message: `任务已启用: ${id}` },
          };
        },
      }),

      // ========== 禁用定时任务 ==========
      createTool({
        name: 'disable',
        description: '禁用定时任务',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: '任务 ID',
            },
          },
          required: ['id'],
        },
        execute: async (args) => {
          const id = args.id as string;
          const error = await this.scheduler.disableJob(id);
          
          if (error) {
            return { success: false, error };
          }

          return {
            success: true,
            output: { message: `任务已禁用: ${id}` },
          };
        },
      }),

      // ========== 更新定时任务 ==========
      createTool({
        name: 'update',
        description: '更新定时任务',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: '任务 ID',
            },
            field: {
              type: 'string',
              description: '要更新的字段: cron_expr, prompt, description, enabled, mute, session_mode, timeout_mins',
              enum: ['cron_expr', 'prompt', 'description', 'enabled', 'mute', 'session_mode', 'timeout_mins'],
            },
            value: {
              type: 'string',
              description: '新值（字符串或数字）',
            },
          },
          required: ['id', 'field', 'value'],
        },
        execute: async (args) => {
          const id = args.id as string;
          const field = args.field as string;
          const value = args.value;

          const error = await this.scheduler.updateJob(id, field, value);
          
          if (error) {
            return { success: false, error };
          }

          return {
            success: true,
            output: { message: `任务已更新: ${id}.${field} = ${value}` },
          };
        },
      }),

      // ========== 静音切换 ==========
      createTool({
        name: 'toggle_mute',
        description: '切换任务静音状态（静音任务不发送任何消息）',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: '任务 ID',
            },
          },
          required: ['id'],
        },
        execute: async (args) => {
          const id = args.id as string;
          const { newState, ok } = this.cronStore.toggleMute(id);
          
          if (!ok) {
            return { success: false, error: `任务不存在: ${id}` };
          }

          return {
            success: true,
            output: {
              message: `任务 ${id} 静音状态: ${newState ? '已静音' : '已恢复'}`,
              mute: newState,
            },
          };
        },
      }),

      // ========== 解释 cron 表达式 ==========
      createTool({
        name: 'explain',
        description: '将 cron 表达式转换为人类可读的描述',
        inputSchema: {
          type: 'object',
          properties: {
            cron_expr: {
              type: 'string',
              description: 'Cron 表达式',
            },
            lang: {
              type: 'string',
              description: '语言: zh, en, ja, es',
              enum: ['zh', 'en', 'ja', 'es'],
            },
          },
          required: ['cron_expr'],
        },
        execute: async (args) => {
          const cronExpr = args.cron_expr as string;
          const lang = (args.lang as CronLanguage) || defaultLanguage;

          // 验证 cron 表达式
          const cron = await import('node-cron');
          if (!cron.validate(cronExpr)) {
            return { success: false, error: `无效的 cron 表达式: ${cronExpr}` };
          }

          const humanReadable = cronExprToHuman(cronExpr, lang);

          return {
            success: true,
            output: {
              cron_expr: cronExpr,
              human_readable: humanReadable,
            },
          };
        },
      }),
    ];
  }
}

// ============================================================
// 工厂函数
// ============================================================

export function createCronMCPServer(config: CronMCPServerConfig, logger: Logger): CronMCPServer {
  return new CronMCPServer(config, logger);
}