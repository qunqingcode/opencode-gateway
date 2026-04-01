/**
 * Cron 定时任务工具集
 * 
 * 工具层只负责：
 * 1. 任务 CRUD（创建、删除、启用、禁用、查询）
 * 2. 任务持久化（CronStore）
 * 
 * 调度逻辑由 Gateway 层的 CronScheduler 负责
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Logger } from '../types';
import { BaseTool } from './base';
import type { ToolDefinition, ToolResult, ToolContext, ITool } from './types';

// ============================================================
// 类型定义
// ============================================================

/** Cron 任务定义 */
export interface CronJob {
  id: string;
  chatId: string;
  cronExpr: string;
  prompt: string;
  description: string;
  enabled: boolean;
  silent?: boolean;
  createdAt: number;
  lastRun?: number;
  lastError?: string;
}

/** 语言类型（内部使用） */
type CronLanguage = 'en' | 'zh';

// ============================================================
// 配置
// ============================================================

interface CronToolConfig {
  dataDir: string;
  defaultLanguage?: CronLanguage;
}

// ============================================================
// CronStore - 任务持久化存储
// ============================================================

/**
 * Cron 任务存储
 * 
 * 提供任务的 CRUD 操作，持久化到 JSON 文件
 */
export class CronStore {
  private jobs = new Map<string, CronJob>();
  private storePath: string;
  private logger: Logger;

  constructor(storePath: string, logger: Logger) {
    this.storePath = storePath;
    this.logger = logger;
    this.load();
  }

  get(id: string): CronJob | undefined {
    return this.jobs.get(id);
  }

  getByChatId(chatId: string): CronJob[] {
    return Array.from(this.jobs.values()).filter((j) => j.chatId === chatId);
  }

  getAllEnabled(): CronJob[] {
    return Array.from(this.jobs.values()).filter((j) => j.enabled);
  }

  getAll(): CronJob[] {
    return Array.from(this.jobs.values());
  }

  set(job: CronJob): void {
    this.jobs.set(job.id, job);
    this.save();
  }

  delete(id: string): boolean {
    const result = this.jobs.delete(id);
    if (result) this.save();
    return result;
  }

  update(id: string, updates: Partial<CronJob>): CronJob | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    Object.assign(job, updates);
    this.save();
    return job;
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.storePath)) return;

      const data = fs.readFileSync(this.storePath, 'utf-8');
      const jobs = JSON.parse(data) as CronJob[];

      for (const job of jobs) {
        this.jobs.set(job.id, job);
      }

      this.logger.info(`[CronStore] Loaded ${this.jobs.size} jobs from ${this.storePath}`);
    } catch (err) {
      this.logger.error(`[CronStore] Failed to load: ${(err as Error).message}`);
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const jobs = Array.from(this.jobs.values());
      fs.writeFileSync(this.storePath, JSON.stringify(jobs, null, 2), 'utf-8');
    } catch (err) {
      this.logger.error(`[CronStore] Failed to save: ${(err as Error).message}`);
    }
  }
}

// ============================================================
// 工具定义
// ============================================================

/** 列出定时任务 */
class ListJobsTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'cron.list',
    description: '列出当前聊天的所有定时任务',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  };

  private store: CronStore;

  constructor(store: CronStore, logger: Logger) {
    super(logger);
    this.store = store;
  }

  async execute(_args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const jobs = this.store.getByChatId(context.chatId).map((j) => ({
      id: j.id,
      description: j.description,
      cronExpr: j.cronExpr,
      enabled: j.enabled,
      lastRun: j.lastRun,
    }));

    return this.success({ jobs });
  }
}

/** 创建定时任务 */
class CreateJobTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'cron.create',
    description: '创建定时任务',
    inputSchema: {
      type: 'object',
      properties: {
        cronExpr: { type: 'string', description: 'Cron 表达式（如 "0 9 * * 1-5" 表示工作日 9:00）' },
        prompt: { type: 'string', description: '任务执行时的提示词' },
        description: { type: 'string', description: '任务描述（可选）' },
      },
      required: ['cronExpr', 'prompt'],
    },
  };

  private store: CronStore;
  private defaultLanguage: CronLanguage;

  constructor(store: CronStore, defaultLanguage: CronLanguage, logger: Logger) {
    super(logger);
    this.store = store;
    this.defaultLanguage = defaultLanguage;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const cronExpr = args.cronExpr as string;
    const prompt = args.prompt as string;
    const description = args.description as string;

    if (!cronExpr || !prompt) {
      return this.error('cronExpr and prompt are required');
    }

    const id = generateCronId();
    const job: CronJob = {
      id,
      chatId: context.chatId,
      cronExpr,
      prompt,
      description: description || prompt.slice(0, 50),
      enabled: true,
      createdAt: Date.now(),
    };

    this.store.set(job);

    return this.success({
      message: '定时任务创建成功',
      jobId: id,
      humanReadable: cronExprToHuman(cronExpr, this.defaultLanguage),
    });
  }
}

/** 删除定时任务 */
class DeleteJobTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'cron.delete',
    description: '删除定时任务',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: '任务 ID' },
      },
      required: ['jobId'],
    },
  };

  private store: CronStore;

  constructor(store: CronStore, logger: Logger) {
    super(logger);
    this.store = store;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const jobId = args.jobId as string;

    if (!jobId || !this.store.get(jobId)) {
      return this.error('Job not found');
    }

    this.store.delete(jobId);

    return this.success({ message: '定时任务已删除' });
  }
}

/** 启用定时任务 */
class EnableJobTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'cron.enable',
    description: '启用定时任务',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: '任务 ID' },
      },
      required: ['jobId'],
    },
  };

  private store: CronStore;

  constructor(store: CronStore, logger: Logger) {
    super(logger);
    this.store = store;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const jobId = args.jobId as string;

    if (!this.store.update(jobId, { enabled: true })) {
      return this.error('Job not found');
    }

    return this.success({ message: '定时任务已启用' });
  }
}

/** 禁用定时任务 */
class DisableJobTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'cron.disable',
    description: '禁用定时任务',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: '任务 ID' },
      },
      required: ['jobId'],
    },
  };

  private store: CronStore;

  constructor(store: CronStore, logger: Logger) {
    super(logger);
    this.store = store;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const jobId = args.jobId as string;

    if (!this.store.update(jobId, { enabled: false })) {
      return this.error('Job not found');
    }

    return this.success({ message: '定时任务已禁用' });
  }
}

/** 立即执行任务 */
class RunJobTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'cron.run',
    description: '立即执行定时任务',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: '任务 ID' },
      },
      required: ['jobId'],
    },
  };

  private store: CronStore;

  constructor(store: CronStore, logger: Logger) {
    super(logger);
    this.store = store;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const jobId = args.jobId as string;
    const job = this.store.get(jobId);

    if (!job) {
      return this.error('Job not found');
    }

    // 更新最后运行时间
    this.store.update(jobId, { lastRun: Date.now() });

    // 返回提示词，让调用方执行
    return this.success({
      message: '任务已触发',
      prompt: job.prompt,
      chatId: job.chatId,
    });
  }
}

// ============================================================
// 工具集工厂
// ============================================================

/**
 * 创建 Cron 工具集
 * 
 * 返回 CRUD 工具和 CronStore 实例
 * 
 * @param config 配置
 * @param logger 日志
 * @returns 工具列表和 CronStore
 */
export function createCronTools(
  config: CronToolConfig,
  logger: Logger
): { tools: ITool[]; store: CronStore } {
  const storePath = path.join(config.dataDir, 'cron-jobs.json');
  const store = new CronStore(storePath, logger);
  const defaultLanguage = config.defaultLanguage || 'zh';

  const tools: ITool[] = [
    new ListJobsTool(store, logger),
    new CreateJobTool(store, defaultLanguage, logger),
    new DeleteJobTool(store, logger),
    new EnableJobTool(store, logger),
    new DisableJobTool(store, logger),
    new RunJobTool(store, logger),
  ];

  return { tools, store };
}

// ============================================================
// 辅助函数（内部使用）
// ============================================================

/** 生成 Cron ID */
function generateCronId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/** Cron 表达式转人类可读 */
function cronExprToHuman(expr: string, lang: CronLanguage = 'zh'): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // 简化处理常见模式
  if (minute === '0' && hour === '*') {
    return lang === 'zh' ? '每小时' : 'Every hour';
  }
  if (minute === '0' && hour !== '*') {
    return lang === 'zh' ? `每天 ${hour}:00` : `Every day at ${hour}:00`;
  }
  if (minute === '*/30' && hour === '*') {
    return lang === 'zh' ? '每30分钟' : 'Every 30 minutes';
  }
  if (minute === '*/15' && hour === '*') {
    return lang === 'zh' ? '每15分钟' : 'Every 15 minutes';
  }
  if (minute === '0' && hour === '9' && dayOfWeek === '1-5') {
    return lang === 'zh' ? '每个工作日 9:00' : 'Every weekday at 9:00';
  }

  return expr;
}