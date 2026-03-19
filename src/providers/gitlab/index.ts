/**
 * GitLab Provider 实现
 */

import * as https from 'https';
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

  constructor(config: GitLabConfig, logger: Logger) {
    super();
    this.config = config;
    this.id = config.id;
    this.name = config.name || 'GitLab';
    this.logger = logger;
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
      const result = await this.request<GitLabUser>('GET', '/user');
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
    const result = await this.request<GitLabBranchResponse[]>('GET', `/projects/${this.config.projectId}/repository/branches`);
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
    const result = await this.request<GitLabBranchResponse>('POST', `/projects/${this.config.projectId}/repository/branches`, {
      branch: name,
      ref,
    });
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
    const params = new URLSearchParams();
    if (state) params.set('state', state === 'open' ? 'opened' : state);

    const result = await this.request<GitLabMergeRequestResponse[]>('GET', `/projects/${this.config.projectId}/merge_requests?${params}`);
    return result.map(mr => this.mapMergeRequest(mr));
  }

  async createMergeRequest(sourceBranch: string, targetBranch: string, title: string): Promise<MergeRequest> {
    const result = await this.request<GitLabMergeRequestResponse>('POST', `/projects/${this.config.projectId}/merge_requests`, {
      source_branch: sourceBranch,
      target_branch: targetBranch,
      title,
      remove_source_branch: true,
    });

    this.recordActivity();
    this.logger?.info(`[${this.id}] Created MR: ${result.web_url}`);

    return this.mapMergeRequest(result);
  }

  async mergeMergeRequest(mrId: number): Promise<MergeRequest> {
    const result = await this.request<GitLabMergeRequestResponse>('PUT', `/projects/${this.config.projectId}/merge_requests/${mrId}/merge`);
    this.recordActivity();

    return this.mapMergeRequest(result);
  }

  async closeMergeRequest(mrId: number): Promise<void> {
    await this.request('PUT', `/projects/${this.config.projectId}/merge_requests/${mrId}`, {
      state_event: 'close',
    });
    this.recordActivity();
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /**
   * 映射 GitLab MR 响应到 MergeRequest 类型
   */
  private mapMergeRequest(mr: GitLabMergeRequestResponse): MergeRequest {
    // GitLab state: opened, merged, closed, locked
    // Our status: open, merged, closed
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

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.config.apiUrl}${path}`);
      const postData = body ? JSON.stringify(body) : undefined;
      
      // 5 秒超时，快速失败
      const timeout = 5000;

      const req = https.request(
        {
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          method,
          headers: {
            'PRIVATE-TOKEN': this.config.token,
            'Content-Type': 'application/json',
            ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
          },
          timeout,
        },
        res => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => {
            try {
              const result = JSON.parse(data);
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve(result);
              } else {
                reject(new Error(result.message || `HTTP ${res.statusCode}`));
              }
            } catch {
              reject(new Error(`Failed to parse response: ${data}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timeout after ${timeout}ms`));
      });
      if (postData) req.write(postData);
      req.end();
    });
  }
}

// ============================================================
// 工厂函数
// ============================================================

export function createGitLabProvider(config: GitLabConfig, logger: Logger): GitLabProvider {
  return new GitLabProvider(config, logger);
}