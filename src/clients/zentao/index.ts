/**
 * 禅道 API Client
 * 
 * 封装禅道 REST API 调用
 * 支持禅道开源版 18+ / 企业版
 */

import { BaseClient } from '../base';
import type { Issue, IssueQuery, IssueCreateParams, Logger } from '../../types';
import { createHttpClient, HttpClient } from '../../utils/http-client';

// ============================================================
// 配置和类型
// ============================================================

export interface ZentaoClientConfig {
  baseUrl: string;
  token?: string;
  account?: string;
  password?: string;
  projectId?: string | number;
}

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
// Zentao Client
// ============================================================

export class ZentaoClient extends BaseClient {
  readonly name = 'Zentao';

  private client: HttpClient;
  private token: string | null = null;
  private projectId?: string | number;
  private account?: string;
  // 敏感信息：使用后应清除
  private password?: string;

  constructor(config: ZentaoClientConfig, logger: Logger) {
    super(config.baseUrl, logger);
    this.projectId = config.projectId;
    this.account = config.account;
    this.password = config.password;

    this.client = createHttpClient({
      baseUrl: config.baseUrl,
      timeout: 30000,
      allowSelfSignedCert: true,
    });

    if (config.token) {
      this.token = config.token;
      this.client.setToken(config.token);
      // 使用 token 时清除密码
      this.password = undefined;
    }
  }

  /**
   * 初始化（登录获取 Token）
   */
  async init(): Promise<void> {
    if (!this.token && this.account && this.password) {
      await this.login();
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    try {
      await this.client.get('/users/me');
      return { healthy: true, message: 'Connected' };
    } catch (error) {
      return { healthy: false, message: (error as Error).message };
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

    const issues = (result?.bugs || []).map(this.mapIssue);

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
      project: this.projectId,
    });

    this.logger.info(`[Zentao] Created issue: ${result.id}`);
    return this.mapIssue(result);
  }

  async updateIssue(issueId: string | number, params: Partial<IssueCreateParams>): Promise<Issue> {
    const result = await this.client.put<ZentaoIssue>(`/bugs/${issueId}`, {
      title: params.title,
      steps: params.description,
      pri: params.priority ? this.mapPriority(params.priority) : undefined,
      assignedTo: params.assignee,
    });

    return this.mapIssue(result);
  }

  async closeIssue(issueId: string | number): Promise<void> {
    await this.client.put(`/bugs/${issueId}/close`);
  }

  async addComment(issueId: string | number, content: string): Promise<void> {
    await this.client.post(`/bugs/${issueId}/comments`, { content });
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private async login(): Promise<void> {
    if (!this.account || !this.password) return;

    try {
      // 使用 HttpClient 而不是原生 fetch，支持自签名证书
      const result = await this.client.post<ZentaoLoginResponse>('/tokens', {
        account: this.account,
        password: this.password,
      });

      this.token = result.token;
      this.client.setToken(result.token);
      this.logger.info(`[Zentao] Login successful`);

      // 登录成功后立即清除敏感密码
      this.password = undefined;
    } catch (error) {
      this.logger.error(`[Zentao] Login failed: ${(error as Error).message}`);
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

export function createZentaoClient(config: ZentaoClientConfig, logger: Logger): ZentaoClient {
  return new ZentaoClient(config, logger);
}