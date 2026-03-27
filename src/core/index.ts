/**
 * Core 模块导出
 * 
 * 包含从 cc-connect 移植的核心功能：
 * - Session 管理
 * - Cron 定时任务
 */

// Session 管理
export {
  CONTINUE_SESSION,
  SessionImpl,
  SessionManager,
  parseSessionKey,
  type Session,
  type HistoryEntry,
  type UserMeta,
} from './session';

// Cron 定时任务
export {
  CronStore,
  CronScheduler,
  validateCronJob,
  normalizeCronSessionMode,
  getExecutionTimeout,
  usesNewSessionPerRun,
  isShellJob,
  generateCronId,
  cronExprToHuman,
  type CronJob,
  type CronLanguage,
  type CronExecutor,
} from './cron';