/**
 * 卡片构建器类型定义
 * 
 * 供飞书卡片构建器使用
 */

// ============================================================
// Payload 类型定义
// ============================================================

/** 权限请求负载 */
export interface PermissionPayload {
  id: string;
  type: string;
  title?: string;
  pattern?: string | string[];
  metadata?: {
    path?: string;
    command?: string;
    url?: string;
    query?: string;
  };
}

/** 问题项 */
export interface QuestionItem {
  question: string;
  options?: string[];
}

/** 问题请求负载 */
export interface QuestionPayload {
  id: string;
  questions: QuestionItem[];
}

/** 代码修改请求负载 */
export interface CodeChangePayload {
  branchName: string;
  summary: string;
  changelog?: string;
  files: string[];
  docUrl?: string;
}

/** 状态卡片负载 */
export interface StatusPayload {
  title: string;
  status: 'success' | 'error' | 'warning' | 'info';
  message: string;
  details?: string;
}

/** 禅道操作类型 */
export type ZentaoActionType = 
  | 'create_bug' 
  | 'create_task' 
  | 'query_bug' 
  | 'query_task'
  | 'query_issue'
  | 'list_bugs'
  | 'list_tasks'
  | 'close_bug' 
  | 'add_comment';

/** 禅道请求负载 */
export interface ZentaoPayload {
  action: ZentaoActionType;
  title?: string;
  description?: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  type?: 'bug' | 'task' | 'feature' | 'story';
  assignee?: string;
  issueId?: number | string;
  comment?: string;
  status?: string;
}

/** 禅道问题类型 */
export interface ZentaoIssue {
  id: number;
  title: string;
  description?: string;
  status: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  type?: 'bug' | 'feature' | 'task' | 'story';
  assignee?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** 卡片上下文 */
export interface CardContext {
  userId: string;
  chatId: string;
  expiresAt?: number;
}