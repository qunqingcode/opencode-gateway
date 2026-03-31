/**
 * Cron 定时任务工具
 * 
 * 功能：
 * 1. 定时任务定义和持久化
 * 2. Cron 表达式解析和调度
 * 3. 任务执行和超时控制
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Logger } from '../types';
import { BaseTool } from './base';
import type { ToolDefinition, ToolResult, ToolContext } from './types';

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

/** 语言类型 */
export type CronLanguage = 'en' | 'zh';

// ============================================================
// 配置
// ============================================================

export interface CronToolConfig {
  dataDir: string;
  defaultLanguage?: CronLanguage;
}

// ============================================================
// Cron 工具
// ============================================================

export class CronTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'cron',
    description: '定时任务管理工具',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型: list, create, delete, enable, disable, run',
        },
      },
      required: ['action'],
    },
  };

  private config: CronToolConfig;
  private jobs = new Map<string, CronJob>();
  private storePath: string;

  constructor(config: CronToolConfig, logger: Logger) {
    super(logger);
    this.config = config;
    this.storePath = path.join(config.dataDir, 'cron-jobs.json');
    this.load();
  }

  async start(): Promise<void> {
    this.logger.info('[CronTool] Started');
  }

  async stop(): Promise<void> {
    this.save();
    this.logger.info('[CronTool] Stopped');
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const action = args.action as string;

    switch (action) {
      case 'list':
        return this.listJobs(context);
      case 'create':
        return this.createJob(args, context);
      case 'delete':
        return this.deleteJob(args);
      case 'enable':
        return this.enableJob(args);
      case 'disable':
        return this.disableJob(args);
      case 'run':
        return this.runJob(args, context);
      default:
        return this.error(`Unknown action: ${action}`);
    }
  }

  // ============================================================
  // 操作实现
  // ============================================================

  private listJobs(context: ToolContext): ToolResult {
    const jobs = Array.from(this.jobs.values())
      .filter((j) => j.chatId === context.chatId)
      .map((j) => ({
        id: j.id,
        description: j.description,
        cronExpr: j.cronExpr,
        enabled: j.enabled,
        lastRun: j.lastRun,
      }));

    return this.success({ jobs });
  }

  private createJob(args: Record<string, unknown>, context: ToolContext): ToolResult {
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

    this.jobs.set(id, job);
    this.save();

    return this.success({
      message: '定时任务创建成功',
      jobId: id,
      humanReadable: cronExprToHuman(cronExpr, this.config.defaultLanguage || 'zh'),
    });
  }

  private deleteJob(args: Record<string, unknown>): ToolResult {
    const jobId = args.jobId as string;

    if (!jobId || !this.jobs.has(jobId)) {
      return this.error('Job not found');
    }

    this.jobs.delete(jobId);
    this.save();

    return this.success({ message: '定时任务已删除' });
  }

  private enableJob(args: Record<string, unknown>): ToolResult {
    const jobId = args.jobId as string;
    const job = this.jobs.get(jobId);

    if (!job) {
      return this.error('Job not found');
    }

    job.enabled = true;
    this.save();

    return this.success({ message: '定时任务已启用' });
  }

  private disableJob(args: Record<string, unknown>): ToolResult {
    const jobId = args.jobId as string;
    const job = this.jobs.get(jobId);

    if (!job) {
      return this.error('Job not found');
    }

    job.enabled = false;
    this.save();

    return this.success({ message: '定时任务已禁用' });
  }

  private runJob(args: Record<string, unknown>, context: ToolContext): ToolResult {
    const jobId = args.jobId as string;
    const job = this.jobs.get(jobId);

    if (!job) {
      return this.error('Job not found');
    }

    // 更新最后运行时间
    job.lastRun = Date.now();
    this.save();

    // 返回提示词，让调用方执行
    return this.success({
      message: '任务已触发',
      prompt: job.prompt,
    });
  }

  // ============================================================
  // 持久化
  // ============================================================

  private load(): void {
    try {
      if (!fs.existsSync(this.storePath)) return;

      const data = fs.readFileSync(this.storePath, 'utf-8');
      const jobs = JSON.parse(data) as CronJob[];

      for (const job of jobs) {
        this.jobs.set(job.id, job);
      }

      this.logger.info(`[CronTool] Loaded ${this.jobs.size} jobs`);
    } catch (err) {
      this.logger.error(`[CronTool] Failed to load: ${(err as Error).message}`);
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
      this.logger.error(`[CronTool] Failed to save: ${(err as Error).message}`);
    }
  }
}

// ============================================================
// 辅助函数
// ============================================================

/** 生成 Cron ID */
export function generateCronId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/** Cron 表达式转人类可读 */
export function cronExprToHuman(expr: string, lang: CronLanguage = 'zh'): string {
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

/** 验证 Cron 表达式 */
export function validateCronExpr(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  return parts.length >= 5 && parts.length <= 6;
}