/**
 * 禅道 Provider 实现（预留）
 * 
 * 禅道 API 文档：https://www.zentao.net/book/zentaopmshelp/562.html
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import {
  BaseProvider,
  IIssueProvider,
  ProviderConfig,
  ProviderCapability,
  Issue,
  IssueQuery,
  IssueCreateParams,
  Logger,
} from '../../core';

// ============================================================
// 禅道配置
// ============================================================

export interface ZentaoConfig extends ProviderConfig {
  /** 禅道地址 */
  baseUrl: string;
  /** API Token */
  token: string;
  /** 账号（可选，Token 模式不需要） */
  account?: string;
  /** 密码（可选，Token 模式不需要） */
  password?: string;
  /** 项目 ID */
  projectId?: string | number;
}

// ============================================================
// 禅道 API 响应类型
// ============================================================

interface ZentaoResponse<T = unknown> {
  status: string;
  data: T;
  message?: string;
}

interface ZentaoIssue {
  id: number;
  title: string;
  steps?: string;
  status: string;
  pri: number;
  type: string;
  assignedTo?: string;
  openedDate?: string;
  lastEditedDate?: string;
}

// ============================================================
// 禅道 Provider
// ============================================================

export class ZentaoProvider extends BaseProvider implements IIssueProvider {
  readonly id: string;
  readonly type = 'issue' as const;
  readonly name: string;
  readonly capabilities: ProviderCapability[] = ['issues', 'project'];

  readonly config: ZentaoConfig;

  private session?: string;

  constructor(config: ZentaoConfig, logger: Logger) {
    super();
    this.config = config;
    this.id = config.id;
    this.name = config.name || 'Zentao';
    this.logger = logger;
  }

  async start(): Promise<{ stop: () => void }> {
    // 尝试获取 session
    if (this.config.account && this.config.password) {
      await this.login();
    }

    this.setStatusRunning('api');
    this.logger?.info(`[${this.id}] Zentao provider started`);
    return {
      stop: () => {
        this.setStatusStopped();
      },
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; message: string; details?: Record<string, unknown> }> {
    try {
      // 获取当前用户信息验证连接
      const result = await this.request<{ account?: string }>('GET', '/user');
      return {
        healthy: true,
        message: 'Connection successful',
        details: {
          user: result?.account ?? 'unknown',
        },
      };
    } catch (error) {
      return {
        healthy: false,
        message: (error as Error).message,
      };
    }
  }

  // ============================================================
  // 问题操作
  // ============================================================

  async getIssues(query: IssueQuery): Promise<{ issues: Issue[]; total: number }> {
    const params = new URLSearchParams();
    if (query.projectId) params.set('projectID', String(query.projectId));
    if (query.status) params.set('status', query.status);
    if (query.assignee) params.set('assignedTo', query.assignee);
    if (query.page) params.set('page', String(query.page));
    if (query.pageSize) params.set('limit', String(query.pageSize));

    const result = await this.request<ZentaoIssue[]>('GET', `/bugs?${params}`);

    const issues = (result || []).map(this.mapIssue);

    return {
      issues,
      total: issues.length, // 禅道 API 可能需要额外调用获取 total
    };
  }

  async getIssue(issueId: string | number): Promise<Issue | null> {
    try {
      const result = await this.request<ZentaoIssue>('GET', `/bugs/${issueId}`);
      return this.mapIssue(result);
    } catch {
      return null;
    }
  }

  async createIssue(params: IssueCreateParams): Promise<Issue> {
    const result = await this.request<ZentaoIssue>('POST', '/bugs', {
      title: params.title,
      steps: params.description,
      pri: this.mapPriority(params.priority),
      type: params.type || 'bug',
      assignedTo: params.assignee,
      project: this.config.projectId,
    });

    this.recordActivity();
    this.logger?.info(`[${this.id}] Created issue: ${result.id}`);

    return this.mapIssue(result);
  }

  async updateIssue(issueId: string | number, params: Partial<IssueCreateParams>): Promise<Issue> {
    const result = await this.request<ZentaoIssue>('PUT', `/bugs/${issueId}`, {
      title: params.title,
      steps: params.description,
      pri: params.priority ? this.mapPriority(params.priority) : undefined,
      assignedTo: params.assignee,
    });

    this.recordActivity();
    return this.mapIssue(result);
  }

  async closeIssue(issueId: string | number): Promise<void> {
    await this.request('PUT', `/bugs/${issueId}`, {
      status: 'closed',
    });
    this.recordActivity();
  }

  async addComment(issueId: string | number, content: string): Promise<void> {
    await this.request('POST', `/bugs/${issueId}/comments`, {
      content,
    });
    this.recordActivity();
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private async login(): Promise<void> {
    if (!this.config.account || !this.config.password) return;
    
    try {
      const result = await this.request<{ session?: string }>('POST', '/user-login.json', {
        account: this.config.account,
        password: this.config.password,
      });
      this.session = result.session;
      this.logger?.info(`[${this.id}] Login successful`);
    } catch (error) {
      this.logger?.error(`[${this.id}] Login failed: ${(error as Error).message}`);
    }
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
      const url = new URL(`${baseUrl}${path}`);
      const httpModule = url.protocol === 'https:' ? https : http;
      const postData = body ? JSON.stringify(body) : undefined;

      const headers: Record<string, string | number> = {
        'Content-Type': 'application/json',
      };

      // Token 认证
      if (this.config.token) {
        headers['Token'] = this.config.token;
      }

      // Session 认证
      if (this.session) {
        headers['Cookie'] = `zentaosid=${this.session}`;
      }

      if (postData) {
        headers['Content-Length'] = Buffer.byteLength(postData);
      }

      const req = httpModule.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          method,
          headers,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const result = JSON.parse(data);
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve(result as T);
              } else {
                reject(new Error(result.message || result.error || `HTTP ${res.statusCode}`));
              }
            } catch {
              reject(new Error(`Failed to parse response: ${data.substring(0, 100)}`));
            }
          });
        }
      );

      req.on('error', (err) => {
        reject(new Error(`Request failed: ${err.message}`));
      });

      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (postData) req.write(postData);
      req.end();
    });
  }

  private mapIssue(zentao: ZentaoIssue): Issue {
    return {
      id: zentao.id,
      title: zentao.title,
      description: zentao.steps,
      status: zentao.status,
      priority: this.mapPriorityFromZentao(zentao.pri),
      type: this.mapTypeFromZentao(zentao.type),
      assignee: zentao.assignedTo,
      createdAt: zentao.openedDate,
      updatedAt: zentao.lastEditedDate,
    };
  }

  private mapPriority(priority?: string): number {
    const map: Record<string, number> = {
      critical: 1,
      high: 2,
      medium: 3,
      low: 4,
    };
    return map[priority || 'medium'] || 3;
  }

  private mapPriorityFromZentao(pri: number): 'critical' | 'high' | 'medium' | 'low' {
    const map: Record<number, 'critical' | 'high' | 'medium' | 'low'> = {
      1: 'critical',
      2: 'high',
      3: 'medium',
      4: 'low',
    };
    return map[pri] || 'medium';
  }

  private mapTypeFromZentao(type: string): 'bug' | 'feature' | 'task' | 'story' {
    const map: Record<string, 'bug' | 'feature' | 'task' | 'story'> = {
      bug: 'bug',
      feature: 'feature',
      task: 'task',
      story: 'story',
      design: 'feature',
      devel: 'task',
    };
    return map[type] || 'task';
  }
}

// ============================================================
// 工厂函数
// ============================================================

export function createZentaoProvider(config: ZentaoConfig, logger: Logger): ZentaoProvider {
  return new ZentaoProvider(config, logger);
}