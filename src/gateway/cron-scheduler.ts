/**
 * Cron Scheduler - Gateway 内部组件
 * 
 * 职责：
 * 1. 使用 node-cron 调度所有启用的任务
 * 2. 任务到期时触发 Gateway 执行
 * 3. 监听 CronStore 变化，动态更新调度
 * 
 * 使用方式：
 * - Gateway.init() 时创建并启动
 * - Gateway.shutdown() 时停止
 */

import * as cron from 'node-cron';
import type { Logger } from '../types';
import type { CronStore, CronJob } from '../tools/cron';

// ============================================================
// 任务执行回调
// ============================================================

/**
 * 任务执行回调
 * 
 * 由 Gateway 提供，scheduler 只负责调度，不负责执行细节
 */
export type CronExecuteCallback = (job: CronJob) => Promise<void>;

// ============================================================
// CronScheduler
// ============================================================

/**
 * Cron 调度器
 * 
 * Gateway 内部组件，管理定时任务的调度和执行
 */
export class CronScheduler {
  private store: CronStore;
  private executeCallback: CronExecuteCallback;
  private logger: Logger;
  private scheduledJobs = new Map<string, cron.ScheduledTask>();

  constructor(
    store: CronStore,
    executeCallback: CronExecuteCallback,
    logger: Logger
  ) {
    this.store = store;
    this.executeCallback = executeCallback;
    this.logger = logger;
  }

  // ============================================================
  // 生命周期
  // ============================================================

  /**
   * 启动调度器
   * 
   * 加载所有已启用的任务并注册定时回调
   */
  start(): void {
    const jobs = this.store.getAllEnabled();

    for (const job of jobs) {
      this.scheduleJob(job);
    }

    this.logger.info(`[CronScheduler] Started with ${this.scheduledJobs.size} scheduled jobs`);
  }

  /**
   * 停止调度器
   */
  stop(): void {
    for (const [jobId, task] of this.scheduledJobs) {
      task.stop();
      this.logger.info(`[CronScheduler] Stopped job: ${jobId}`);
    }

    this.scheduledJobs.clear();
    this.logger.info('[CronScheduler] All jobs stopped');
  }

  /**
   * 重新加载所有任务
   * 
   * 用于任务变更后同步调度状态
   */
  reload(): void {
    // 获取当前所有启用的任务
    const enabledJobs = new Map<string, CronJob>();
    for (const job of this.store.getAllEnabled()) {
      enabledJobs.set(job.id, job);
    }

    // 取消已禁用的任务
    for (const [jobId, task] of this.scheduledJobs) {
      if (!enabledJobs.has(jobId)) {
        task.stop();
        this.scheduledJobs.delete(jobId);
        this.logger.info(`[CronScheduler] Removed disabled job: ${jobId}`);
      }
    }

    // 添加新启用的任务
    for (const [jobId, job] of enabledJobs) {
      if (!this.scheduledJobs.has(jobId)) {
        this.scheduleJob(job);
      }
    }

    this.logger.info(`[CronScheduler] Reloaded: ${this.scheduledJobs.size} active jobs`);
  }

  // ============================================================
  // 任务调度
  // ============================================================

  /**
   * 调度单个任务
   */
  private scheduleJob(job: CronJob): void {
    // 验证 cron 表达式
    if (!cron.validate(job.cronExpr)) {
      this.logger.error(`[CronScheduler] Invalid cron expression: ${job.cronExpr} (job: ${job.id})`);
      return;
    }

    // 创建定时任务
    const task = cron.schedule(job.cronExpr, async () => {
      await this.executeJob(job);
    });

    this.scheduledJobs.set(job.id, task);
    this.logger.info(`[CronScheduler] Scheduled: ${job.id} (${job.cronExpr})`);
  }

  /**
   * 执行任务
   */
  private async executeJob(job: CronJob): Promise<void> {
    this.logger.info(`[CronScheduler] Executing: ${job.id} - ${job.description}`);

    try {
      // 调用 Gateway 提供的执行回调
      await this.executeCallback(job);

      // 更新最后执行时间
      this.store.update(job.id, { lastRun: Date.now(), lastError: undefined });

      this.logger.info(`[CronScheduler] Job ${job.id} completed`);
    } catch (error) {
      const errorMessage = (error as Error).message;
      this.logger.error(`[CronScheduler] Job ${job.id} failed: ${errorMessage}`);

      // 记录错误
      this.store.update(job.id, { lastError: errorMessage });
    }
  }

  // ============================================================
  // 查询
  // ============================================================

  /**
   * 获取已调度任务数量
   */
  getScheduledCount(): number {
    return this.scheduledJobs.size;
  }

  /**
   * 检查任务是否已调度
   */
  isScheduled(jobId: string): boolean {
    return this.scheduledJobs.has(jobId);
  }

  /**
   * 获取所有已调度任务的 ID
   */
  getScheduledJobIds(): string[] {
    return Array.from(this.scheduledJobs.keys());
  }
}