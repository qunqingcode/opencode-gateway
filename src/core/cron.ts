/**
 * Cron 定时任务管理 (参考 cc-connect/core/cron.go)
 * 
 * 功能：
 * 1. 定时任务定义和持久化
 * 2. Cron 表达式解析和调度
 * 3. 任务执行和超时控制
 * 4. 多语言人性化时间描述
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Logger } from '../types';

// ============================================================
// 类型定义
// ============================================================

/** Cron 任务定义 */
export interface CronJob {
  id: string;
  project: string;
  sessionKey: string;
  cronExpr: string;
  prompt: string;
  exec?: string;             // shell command; mutually exclusive with prompt
  workDir?: string;          // working directory for exec
  description: string;
  enabled: boolean;
  silent?: boolean;          // suppress start notification
  mute: boolean;             // suppress ALL messages
  sessionMode?: string;      // '' or 'reuse' = share active session; 'new_per_run' = fresh session
  timeoutMins?: number;      // null = default 30m; 0 = no limit; >0 = minutes
  createdAt: number;
  lastRun?: number;
  lastError?: string;
}

/** 语言类型 */
export type CronLanguage = 'en' | 'zh' | 'zh-tw' | 'ja' | 'es';

// ============================================================
// 常量
// ============================================================

const DEFAULT_CRON_JOB_TIMEOUT = 30 * 60 * 1000; // 30 minutes in ms

const CRON_WEEKDAYS: Record<CronLanguage, string[]> = {
  'en': ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  'zh': ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  'zh-tw': ['週日', '週一', '週二', '週三', '週四', '週五', '週六'],
  'ja': ['日曜', '月曜', '火曜', '水曜', '木曜', '金曜', '土曜'],
  'es': ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
};

const CRON_MONTHS: Record<CronLanguage, string[]> = {
  'en': ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  'zh': ['', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  'zh-tw': ['', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  'ja': ['', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  'es': ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
};

// ============================================================
// CronJob 辅助方法
// ============================================================

/** 是否是 Shell 任务 */
export function isShellJob(job: CronJob): boolean {
  return !!job.exec;
}

/** 获取执行超时时间 */
export function getExecutionTimeout(job: CronJob): number {
  if (job.timeoutMins === undefined) return DEFAULT_CRON_JOB_TIMEOUT;
  if (job.timeoutMins <= 0) return 0; // no limit
  return job.timeoutMins * 60 * 1000;
}

/** 是否使用新 Session */
export function usesNewSessionPerRun(job: CronJob): boolean {
  return normalizeCronSessionMode(job.sessionMode || '') === 'new_per_run';
}

/** 规范化 Session 模式 */
export function normalizeCronSessionMode(mode: string): string {
  const low = mode.toLowerCase().trim();
  if (low === '' || low === 'reuse') return '';
  if (low === 'new_per_run' || low === 'new-per-run') return 'new_per_run';
  return mode;
}

/** 验证 CronJob */
export function validateCronJob(job: CronJob): string | null {
  const mode = normalizeCronSessionMode(job.sessionMode || '');
  if (mode !== '' && mode !== 'new_per_run') {
    return `invalid session_mode "${job.sessionMode}" (want reuse, new_per_run, or new-per-run)`;
  }
  if (job.timeoutMins !== undefined && job.timeoutMins < 0) {
    return 'timeout_mins must be >= 0';
  }
  return null;
}

// ============================================================
// CronStore - 持久化存储
// ============================================================

/**
 * Cron 任务存储
 * 
 * 持久化到 JSON 文件
 */
export class CronStore {
  private path: string;
  private jobs: CronJob[] = [];
  private logger: Logger;

  constructor(dataDir: string, logger: Logger) {
    const dir = path.join(dataDir, 'crons');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.path = path.join(dir, 'jobs.json');
    this.logger = logger;
    this.load();
  }

  /** 从文件加载 */
  private load(): void {
    try {
      if (!fs.existsSync(this.path)) return;
      const data = fs.readFileSync(this.path, 'utf-8');
      this.jobs = JSON.parse(data);
    } catch (err) {
      this.logger.error(`[Cron] Failed to load jobs: ${err}`);
    }
  }

  /** 保存到文件 */
  private save(): void {
    try {
      const data = JSON.stringify(this.jobs, null, 2);
      fs.writeFileSync(this.path, data, 'utf-8');
    } catch (err) {
      this.logger.warn(`[Cron] Failed to save jobs: ${err}`);
    }
  }

  /** 添加任务 */
  add(job: CronJob): void {
    this.jobs.push(job);
    this.save();
  }

  /** 移除任务 */
  remove(id: string): boolean {
    const idx = this.jobs.findIndex(j => j.id === id);
    if (idx < 0) return false;
    this.jobs.splice(idx, 1);
    this.save();
    return true;
  }

  /** 设置启用状态 */
  setEnabled(id: string, enabled: boolean): boolean {
    const job = this.jobs.find(j => j.id === id);
    if (!job) return false;
    job.enabled = enabled;
    this.save();
    return true;
  }

  /** 设置静音状态 */
  setMute(id: string, mute: boolean): boolean {
    const job = this.jobs.find(j => j.id === id);
    if (!job) return false;
    job.mute = mute;
    this.save();
    return true;
  }

  /** 切换静音状态 */
  toggleMute(id: string): { newState: boolean; ok: boolean } {
    const job = this.jobs.find(j => j.id === id);
    if (!job) return { newState: false, ok: false };
    job.mute = !job.mute;
    this.save();
    return { newState: job.mute, ok: true };
  }

  /** 标记任务已运行 */
  markRun(id: string, err?: Error): void {
    const job = this.jobs.find(j => j.id === id);
    if (!job) return;
    job.lastRun = Date.now();
    job.lastError = err ? err.message : undefined;
    this.save();
  }

  /** 获取所有任务 */
  list(): CronJob[] {
    return [...this.jobs];
  }

  /** 按项目获取任务 */
  listByProject(project: string): CronJob[] {
    return this.jobs.filter(j => j.project === project);
  }

  /** 按 SessionKey 获取任务 */
  listBySessionKey(sessionKey: string): CronJob[] {
    return this.jobs.filter(j => j.sessionKey === sessionKey);
  }

  /** 按 ID 获取任务 */
  get(id: string): CronJob | undefined {
    return this.jobs.find(j => j.id === id);
  }

  /** 更新任务字段 */
  update(id: string, field: string, value: unknown): boolean {
    const readOnlyFields = ['id', 'createdAt', 'lastRun', 'lastError'];
    if (readOnlyFields.includes(field)) return false;

    const job = this.jobs.find(j => j.id === id);
    if (!job) return false;

    const error = updateJobField(job, field, value);
    if (error) return false;
    this.save();
    return true;
  }
}

/** 更新任务字段 */
function updateJobField(job: CronJob, field: string, value: unknown): string | null {
  switch (field) {
    case 'project':
      if (typeof value === 'string') { job.project = value; return null; }
      break;
    case 'session_key':
      if (typeof value === 'string') { job.sessionKey = value; return null; }
      break;
    case 'cron_expr':
      if (typeof value === 'string') { job.cronExpr = value; return null; }
      break;
    case 'prompt':
      if (typeof value === 'string') { job.prompt = value; return null; }
      break;
    case 'exec':
      if (typeof value === 'string') { job.exec = value; return null; }
      break;
    case 'work_dir':
      if (typeof value === 'string') { job.workDir = value; return null; }
      break;
    case 'description':
      if (typeof value === 'string') { job.description = value; return null; }
      break;
    case 'enabled':
      if (typeof value === 'boolean') { job.enabled = value; return null; }
      break;
    case 'silent':
      if (typeof value === 'boolean') { job.silent = value; return null; }
      break;
    case 'mute':
      if (typeof value === 'boolean') { job.mute = value; return null; }
      break;
    case 'session_mode':
      if (typeof value === 'string') { job.sessionMode = value; return null; }
      break;
    case 'timeout_mins':
      if (typeof value === 'number') { job.timeoutMins = value; return null; }
      break;
  }
  return `unknown or invalid field: ${field}`;
}

// ============================================================
// CronScheduler - 任务调度器
// ============================================================

/** 任务执行器接口 */
export interface CronExecutor {
  executeCronJob(job: CronJob): Promise<void>;
}

/**
 * Cron 任务调度器
 * 
 * 使用 node-cron 进行调度，注入消息到执行器
 */
export class CronScheduler {
  private store: CronStore;
  private executors: Record<string, CronExecutor> = {};
  private entries: Record<string, ReturnType<typeof import('node-cron').schedule>> = {};
  private defaultSilent: boolean = false;
  private logger: Logger;
  private cron: typeof import('node-cron') | null = null;

  constructor(store: CronStore, logger: Logger) {
    this.store = store;
    this.logger = logger;
    // 动态加载 node-cron
    this.loadCron();
  }

  /** 加载 node-cron */
  private async loadCron(): Promise<void> {
    try {
      this.cron = await import('node-cron');
    } catch {
      this.logger.warn('[Cron] node-cron not installed, scheduler disabled');
    }
  }

  /** 注册执行器 */
  registerExecutor(name: string, executor: CronExecutor): void {
    this.executors[name] = executor;
  }

  /** 设置默认静音 */
  setDefaultSilent(silent: boolean): void {
    this.defaultSilent = silent;
  }

  /** 是否静音 */
  isSilent(job: CronJob): boolean {
    return job.silent ?? this.defaultSilent;
  }

  /** 启动调度器 */
  async start(): Promise<void> {
    if (!this.cron) {
      this.logger.warn('[Cron] Cannot start: node-cron not loaded');
      return;
    }

    const jobs = this.store.list();
    for (const job of jobs) {
      if (job.enabled) {
        this.scheduleJob(job);
      }
    }
    this.logger.info(`[Cron] Scheduler started, jobs: ${jobs.length}`);
  }

  /** 停止调度器 */
  stop(): void {
    for (const entry of Object.values(this.entries)) {
      if (entry && entry.stop) entry.stop();
    }
    this.entries = {};
  }

  /** 添加任务 */
  async addJob(job: CronJob): Promise<string | null> {
    const error = validateCronJob(job);
    if (error) return error;

    job.sessionMode = normalizeCronSessionMode(job.sessionMode || '');

    // 验证 cron 表达式
    if (!this.cron) {
      return 'node-cron not loaded';
    }
    if (!this.cron.validate(job.cronExpr)) {
      return `invalid cron expression "${job.cronExpr}"`;
    }

    this.store.add(job);
    if (job.enabled) {
      this.scheduleJob(job);
    }
    return null;
  }

  /** 移除任务 */
  removeJob(id: string): boolean {
    const entry = this.entries[id];
    if (entry && entry.stop) {
      entry.stop();
    }
    delete this.entries[id];
    return this.store.remove(id);
  }

  /** 启用任务 */
  enableJob(id: string): string | null {
    if (!this.store.setEnabled(id, true)) {
      return `job "${id}" not found`;
    }
    const job = this.store.get(id);
    if (job) {
      this.scheduleJob(job);
    }
    return null;
  }

  /** 禁用任务 */
  disableJob(id: string): string | null {
    if (!this.store.setEnabled(id, false)) {
      return `job "${id}" not found`;
    }
    const entry = this.entries[id];
    if (entry && entry.stop) {
      entry.stop();
    }
    delete this.entries[id];
    return null;
  }

  /** 更新任务 */
  updateJob(id: string, field: string, value: unknown): string | null {
    const job = this.store.get(id);
    if (!job) return `job "${id}" not found`;

    // 验证 cron 表达式
    if (field === 'cron_expr') {
      if (typeof value !== 'string') return 'cron_expr must be a string';
      if (!this.cron || !this.cron.validate(value)) {
        return `invalid cron expression "${value}"`;
      }
    }

    // 是否需要重新调度
    const needsReschedule = field === 'cron_expr' || field === 'enabled';

    if (needsReschedule) {
      const entry = this.entries[id];
      if (entry && entry.stop) {
        entry.stop();
      }
      delete this.entries[id];
    }

    if (!this.store.update(id, field, value)) {
      return `failed to update field "${field}"`;
    }

    if (needsReschedule) {
      const updatedJob = this.store.get(id);
      if (updatedJob && updatedJob.enabled) {
        this.scheduleJob(updatedJob);
      }
    }

    return null;
  }

  /** 获取 Store */
  getStore(): CronStore {
    return this.store;
  }

  /** 获取下次运行时间 */
  nextRun(jobId: string): Date | null {
    const entry = this.entries[jobId];
    if (!entry) return null;
    // node-cron 不直接提供 nextRun，需要自己计算
    return null;
  }

  /** 调度任务 */
  private scheduleJob(job: CronJob): void {
    if (!this.cron) return;

    // 移除现有调度
    const oldEntry = this.entries[job.id];
    if (oldEntry && oldEntry.stop) {
      oldEntry.stop();
    }

    const task = this.cron.schedule(job.cronExpr, () => {
      this.executeJob(job.id);
    });

    this.entries[job.id] = task;
  }

  /** 执行任务 */
  private async executeJob(jobId: string): Promise<void> {
    const job = this.store.get(jobId);
    if (!job || !job.enabled) return;

    const executor = this.executors[job.project];
    if (!executor) {
      this.logger.error(`[Cron] Project not found: ${jobId}, project: ${job.project}`);
      this.store.markRun(jobId, new Error(`project "${job.project}" not found`));
      return;
    }

    this.logger.info(`[Cron] Executing job: ${jobId}, project: ${job.project}, prompt: ${truncate(job.prompt, 60)}`);

    const timeout = getExecutionTimeout(job);
    let error: Error | undefined;

    try {
      if (timeout > 0) {
        // 带超时执行
        const result = await Promise.race([
          executor.executeCronJob(job),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`job timed out after ${timeout / 60000}m`)), timeout)
          ),
        ]);
      } else {
        // 无限等待
        await executor.executeCronJob(job);
      }
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`[Cron] Job failed: ${jobId}, error: ${error.message}`);
    }

    this.store.markRun(jobId, error);

    if (!error) {
      this.logger.info(`[Cron] Job completed: ${jobId}`);
    }
  }
}

// ============================================================
// 辅助函数
// ============================================================

/** 生成 Cron ID */
export function generateCronId(): string {
  const bytes = crypto.randomBytes(4);
  return bytes.toString('hex');
}

/** 截断字符串 */
function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '...';
}

/** 补零 */
function padZero(s: string): string {
  if (s.length === 1) return '0' + s;
  return s;
}

/** 解析步进表达式 (如 '* /5') */
function parseStep(field: string): { n: number; ok: boolean } {
  if (!field.startsWith('*/')) return { n: 0, ok: false };
  const n = parseInt(field.slice(2), 10);
  if (n > 0) return { n, ok: true };
  return { n: 0, ok: false };
}

/** 是否是中文类语言 */
function isZhLikeLang(lang: CronLanguage): boolean {
  return lang === 'zh' || lang === 'zh-tw' || lang === 'ja';
}

/**
 * Cron 表达式转人类可读字符串
 * 
 * 支持多语言：en, zh, zh-tw, ja, es
 */
export function cronExprToHuman(expr: string, lang: CronLanguage = 'zh'): string {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return expr;

  const [minute, hour, dom, month, dow] = fields;
  const weekdays = CRON_WEEKDAYS[lang] || CRON_WEEKDAYS['en'];
  const months = CRON_MONTHS[lang] || CRON_MONTHS['en'];
  const cjk = isZhLikeLang(lang);
  const allWild = dom === '*' && month === '*' && dow === '*';

  // 纯间隔: */N * * * * → "每 N 分钟"
  const minStep = parseStep(minute);
  if (minStep.ok && hour === '*' && allWild) {
    switch (lang) {
      case 'zh': return `每${minStep.n}分钟`;
      case 'zh-tw': return `每${minStep.n}分鐘`;
      case 'ja': return `${minStep.n}分ごと`;
      case 'es': return `Cada ${minStep.n} min`;
      default: return `Every ${minStep.n} min`;
    }
  }

  // 小时间隔: M */N * * * → "每 N 小时 (:MM)"
  const hourStep = parseStep(hour);
  if (hourStep.ok && allWild) {
    const m = minute === '*' ? '00' : padZero(minute);
    switch (lang) {
      case 'zh': return `每${hourStep.n}小时 (:${m})`;
      case 'zh-tw': return `每${hourStep.n}小時 (:${m})`;
      case 'ja': return `${hourStep.n}時間ごと (:${m})`;
      case 'es': return `Cada ${hourStep.n} h (:${m})`;
      default: return `Every ${hourStep.n} h (:${m})`;
    }
  }

  const parts: string[] = [];

  // 周几
  if (dow !== '*') {
    const n = parseInt(dow, 10);
    if (n >= 0 && n <= 6) {
      if (cjk) {
        parts.push(weekdays[n]);
      } else {
        parts.push('Every ' + weekdays[n]);
      }
    } else {
      parts.push(`weekday(${dow})`);
    }
  }

  // 月份
  if (month !== '*') {
    const n = parseInt(month, 10);
    if (n >= 1 && n <= 12) {
      parts.push(months[n]);
    }
  }

  // 日期
  if (dom !== '*') {
    if (cjk) {
      parts.push(dom + '日');
    } else {
      parts.push('day ' + dom);
    }
  }

  // 时间
  if (hour !== '*' && minute !== '*') {
    const minStepInner = parseStep(minute);
    if (minStepInner.ok) {
      switch (lang) {
        case 'zh':
        case 'zh-tw':
          parts.push(`${padZero(hour)}时 每${minStepInner.n}分钟`);
          break;
        case 'ja':
          parts.push(`${padZero(hour)}時 ${minStepInner.n}分ごと`);
          break;
        default:
          parts.push(`hour ${padZero(hour)} every ${minStepInner.n} min`);
      }
    } else {
      parts.push(`${padZero(hour)}:${padZero(minute)}`);
    }
  } else if (hour !== '*') {
    if (cjk) {
      parts.push(hour + '時');
    } else {
      parts.push('hour ' + hour);
    }
  } else if (minute !== '*') {
    const minStepInner = parseStep(minute);
    if (minStepInner.ok) {
      switch (lang) {
        case 'zh': return `每${minStepInner.n}分钟`;
        case 'zh-tw': return `每${minStepInner.n}分鐘`;
        case 'ja': return `${minStepInner.n}分ごと`;
        default: return `every ${minStepInner.n} min`;
      }
    } else {
      switch (lang) {
        case 'zh':
        case 'zh-tw':
          parts.push('每小时第' + minute + '分');
          break;
        case 'ja':
          parts.push('毎時' + minute + '分');
          break;
        default:
          parts.push('minute ' + minute + ' of every hour');
      }
    }
  }

  // 频率提示
  if (allWild) {
    switch (lang) {
      case 'zh':
      case 'zh-tw':
        return '每天 ' + parts.join(' ');
      case 'ja':
        return '毎日 ' + parts.join(' ');
      case 'es':
        return 'Diario ' + parts.join(' ');
      default:
        return 'Daily at ' + parts.join(' ');
    }
  }

  if (dow !== '*' && month === '*' && dom === '*') {
    switch (lang) {
      case 'zh':
      case 'zh-tw':
        return '每' + parts.join(' ');
      case 'ja':
        return '毎' + parts.join(' ');
      default:
        return parts.join(' at ');
    }
  }

  if (dom !== '*' && month === '*' && dow === '*') {
    switch (lang) {
      case 'zh':
      case 'zh-tw':
        return '每月' + parts.join(' ');
      case 'ja':
        return '毎月' + parts.join(' ');
      case 'es':
        return 'Mensual, ' + parts.join(', ');
      default:
        return 'Monthly, ' + parts.join(', ');
    }
  }

  if (cjk) {
    return parts.join(' ');
  }
  return parts.join(', ');
}