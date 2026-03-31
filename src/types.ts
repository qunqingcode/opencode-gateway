/**
 * 全局类型定义
 */

// ============================================================
// Logger
// ============================================================

export interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
}

// ============================================================
// 通用类型
// ============================================================

/** 分支 */
export interface Branch {
  name: string;
  protected?: boolean;
  lastCommit?: {
    id: string;
    message: string;
    author: string;
    date: string;
  };
}

/** 合并请求 */
export interface MergeRequest {
  id: string | number;
  title: string;
  description?: string;
  status: 'open' | 'merged' | 'closed';
  sourceBranch: string;
  targetBranch: string;
  url: string;
  author?: string;
  createdAt?: string;
}

/** 问题/Bug */
export interface Issue {
  id: string | number;
  title: string;
  description?: string;
  status: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  type?: 'bug' | 'feature' | 'task' | 'story';
  assignee?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** 问题查询 */
export interface IssueQuery {
  projectId?: string | number;
  status?: string;
  assignee?: string;
  type?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

/** 创建问题参数 */
export interface IssueCreateParams {
  title: string;
  description?: string;
  type?: string;
  priority?: string;
  assignee?: string;
  [key: string]: unknown;
}