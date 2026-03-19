/**
 * GitLab Provider 实现
 * 
 * 使用通用 HTTP 客户端
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import {
  BaseProvider,
  IRepositoryProvider,
  ProviderConfig,
  ProviderCapability,
  MergeRequest,
  Branch,
  Logger,
} from '../../core';
import { createHttpClient, HttpClient } from '../../utils/http-client';

const execAsync = promisify(exec);

// ============================================================
// GitLab 配置
// ============================================================

export interface GitLabConfig extends ProviderConfig {
  /** GitLab API URL */
  apiUrl: string;
  /** GitLab Token */
  token: string;
  /** 项目 ID */
  projectId: string;
}

// ============================================================
// GitLab API 响应类型
// ============================================================

interface GitLabUser {
  username: string;
  id: number;
  name: string;
}

interface GitLabBranchResponse {
  name: string;
  protected?: boolean;
  commit?: {
    id: string;
    message: string;
    author_name: string;
    created_at: string;
  };
}

interface GitLabMergeRequestResponse {
  id: number;
  iid: number;
  title: string;
  description?: string;
  state: 'opened' | 'merged' | 'closed' | 'locked';
  source_branch: string;
  target_branch: string;
  web_url: string;
  author?: { username: string };
  created_at: string;
}

// ============================================================
// GitLab Provider
// ============================================================

export class GitLabProvider extends BaseProvider implements IRepositoryProvider {
  readonly id: string;
  readonly type = 'vcs' as const;
  readonly name: string;
  readonly capabilities: ProviderCapability[] = ['repository'];

  readonly config: GitLabConfig;
  private client: HttpClient;

  constructor(config: GitLabConfig, logger: Logger) {
    super();
    this.config = config;
    this.id = config.id;
    this.name = config.name || 'GitLab';
    this.logger = logger;

    // 初始化 HTTP 客户端
    this.client = createHttpClient({
      baseUrl: config.apiUrl,
      token: config.token,
      tokenLocation: 'private-token',
      timeout: 10000,
      allowSelfSignedCert: true,
    });
  }

  async start(): Promise<{ stop: () => void }> {
    this.setStatusRunning('api');
    this.logger?.info(`[${this.id}] GitLab provider started`);
    return {
      stop: () => {
        this.setStatusStopped();
      },
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; message: string; details?: Record<string, unknown> }> {
    try {
      const result = await this.client.get<GitLabUser>('/user');
      return {
        healthy: true,
        message: 'Connection successful',
        details: {
          user: result.username,
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
  // 分支操作
  // ============================================================

  async getBranches(): Promise<Branch[]> {
    const result = await this.client.get<GitLabBranchResponse[]>(
      `/projects/${this.config.projectId}/repository/branches`
    );
    return result.map(b => ({
      name: b.name,
      protected: b.protected,
      lastCommit: b.commit
        ? {
            id: b.commit.id,
            message: b.commit.message,
            author: b.commit.author_name,
            date: b.commit.created_at,
          }
        : undefined,
    }));
  }

  async createBranch(name: string, ref: string = 'main'): Promise<Branch> {
    const result = await this.client.post<GitLabBranchResponse>(
      `/projects/${this.config.projectId}/repository/branches`,
      { branch: name, ref }
    );
    return {
      name: result.name,
      protected: result.protected,
    };
  }

  async pushBranch(name: string): Promise<boolean> {
    try {
      await execAsync(`git push origin ${name}`, { cwd: process.cwd() });
      this.logger?.info(`[${this.id}] Pushed branch: ${name}`);
      this.recordActivity();
      return true;
    } catch (err) {
      this.logger?.error(`[${this.id}] Push failed: ${(err as Error).message}`);
      return false;
    }
  }

  // ============================================================
  // Merge Request 操作
  // ============================================================

  async getMergeRequests(state?: 'open' | 'merged' | 'closed'): Promise<MergeRequest[]> {
    const params: Record<string, string> = {};
    if (state) {
      params.state = state === 'open' ? 'opened' : state;
    }

    const result = await this.client.get<GitLabMergeRequestResponse[]>(
      `/projects/${this.config.projectId}/merge_requests`,
      Object.keys(params).length > 0 ? params : undefined
    );

    return result.map(mr => this.mapMergeRequest(mr));
  }

  async createMergeRequest(sourceBranch: string, targetBranch: string, title: string): Promise<MergeRequest> {
    const result = await this.client.post<GitLabMergeRequestResponse>(
      `/projects/${this.config.projectId}/merge_requests`,
      {
        source_branch: sourceBranch,
        target_branch: targetBranch,
        title,
        remove_source_branch: true,
      }
    );

    this.recordActivity();
    this.logger?.info(`[${this.id}] Created MR: ${result.web_url}`);

    return this.mapMergeRequest(result);
  }

  async mergeMergeRequest(mrId: number): Promise<MergeRequest> {
    const result = await this.client.put<GitLabMergeRequestResponse>(
      `/projects/${this.config.projectId}/merge_requests/${mrId}/merge`
    );
    this.recordActivity();

    return this.mapMergeRequest(result);
  }

  async closeMergeRequest(mrId: number): Promise<void> {
    await this.client.put(
      `/projects/${this.config.projectId}/merge_requests/${mrId}`,
      { state_event: 'close' }
    );
    this.recordActivity();
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /**
   * 映射 GitLab MR 响应到 MergeRequest 类型
   */
  private mapMergeRequest(mr: GitLabMergeRequestResponse): MergeRequest {
    let status: MergeRequest['status'] = 'open';
    if (mr.state === 'merged') status = 'merged';
    else if (mr.state === 'closed') status = 'closed';

    return {
      id: mr.iid,
      title: mr.title,
      description: mr.description,
      status,
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
      url: mr.web_url,
      author: mr.author?.username,
      createdAt: mr.created_at,
    };
  }
}

// ============================================================
// 工厂函数
// ============================================================

export function createGitLabProvider(config: GitLabConfig, logger: Logger): GitLabProvider {
  return new GitLabProvider(config, logger);
}