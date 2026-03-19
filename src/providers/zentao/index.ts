/**
 * 禅道 Provider 实现
 * 
 * 使用通用 HTTP 客户端
 * 支持禅道开源版 18+ / 企业版 RESTful API
 * 文档：https://www.zentao.net/book/api/1397.html
 */

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
import { createHttpClient, HttpClient } from '../../utils/http-client';

// ============================================================
// 禅道配置
// ============================================================

export interface ZentaoConfig extends ProviderConfig {
  /** 禅道 API 地址，如 http://zentao/api.php/v1 */
  baseUrl: string;
  /** API Token（可选，如果有直接使用） */
  token?: string;
  /** 账号（用于登录获取 Token） */
  account?: string;
  /** 密码（用于登录获取 Token） */
  password?: string;
  /** 项目 ID */
  projectId?: string | number;
}

// ============================================================
// 禅道 API 响应类型
// ============================================================

interface ZentaoLoginResponse {
  token: string;
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
  private client: HttpClient;
  private token: string | null = null;

  constructor(config: ZentaoConfig, logger: Logger) {
    super();
    this.config = config;
    this.id = config.id;
    this.name = config.name || 'Zentao';
    this.logger = logger;

    // 初始化 HTTP 客户端（先不设置 token，登录后再设置）
    this.client = createHttpClient({
      baseUrl: config.baseUrl,
      timeout: 30000,
      allowSelfSignedCert: true,
    });

    // 如果配置了 token，直接使用
    if (config.token) {
      this.token = config.token;
      this.client.setToken(config.token);
    }
  }

  async start(): Promise<{ stop: () => void }> {
    // 如果没有 token，用账号密码登录获取
    if (!this.token && this.config.account && this.config.password) {
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
      // 尝试获取用户信息验证连接
      const result = await this.client.get<{ id?: number; account?: string }>('/users/me');
      return {
        healthy: true,
        message: 'Connection successful',
        details: {
          user: result?.account ?? 'unknown',
          token: this.token ? 'valid' : 'missing',
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
    const params: Record<string, string> = {};
    if (query.projectId) params.project = String(query.projectId);
    if (query.status) params.status = query.status;
    if (query.assignee) params.assignedTo = query.assignee;
    if (query.page) params.page = String(query.page);
    if (query.pageSize) params.limit = String(query.pageSize);

    const result = await this.client.get<{ bugs?: ZentaoIssue[]; total?: number }>(
      '/bugs',
      Object.keys(params).length > 0 ? params : undefined
    );

    const issues = (result?.bugs || result as unknown as ZentaoIssue[] || []).map(this.mapIssue);

    return {
      issues,
      total: result?.total ?? issues.length,
    };
  }

  async getIssue(issueId: string | number): Promise<Issue | null> {
    try {
      const result = await this.client.get<ZentaoIssue>(`/bugs/${issueId}`);
      return this.mapIssue(result);
    } catch {
      return null;
    }
  }

  async createIssue(params: IssueCreateParams): Promise<Issue> {
    const result = await this.client.post<ZentaoIssue>('/bugs', {
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
    const result = await this.client.put<ZentaoIssue>(`/bugs/${issueId}`, {
      title: params.title,
      steps: params.description,
      pri: params.priority ? this.mapPriority(params.priority) : undefined,
      assignedTo: params.assignee,
    });

    this.recordActivity();
    return this.mapIssue(result);
  }

  async closeIssue(issueId: string | number): Promise<void> {
    await this.client.put(`/bugs/${issueId}/close`);
    this.recordActivity();
  }

  async addComment(issueId: string | number, content: string): Promise<void> {
    await this.client.post(`/bugs/${issueId}/comments`, { content });
    this.recordActivity();
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /**
   * 登录获取 Token
   * API: POST /tokens
   */
  private async login(): Promise<void> {
    if (!this.config.account || !this.config.password) return;

    try {
      // 禅道登录需要特殊处理，不使用 Token
      const response = await fetch(`${this.config.baseUrl.replace(/\/+$/, '')}/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: this.config.account,
          password: this.config.password,
        }),
      });

      if (!response.ok) {
        throw new Error(`Login failed: HTTP ${response.status}`);
      }

      const result = await response.json() as ZentaoLoginResponse;
      this.token = result.token;
      this.client.setToken(result.token);
      this.logger?.info(`[${this.id}] Login successful, token obtained`);
    } catch (error) {
      this.logger?.error(`[${this.id}] Login failed: ${(error as Error).message}`);
      throw error;
    }
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