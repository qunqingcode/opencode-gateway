/**
 * GitLab API Client
 * 
 * 封装 GitLab REST API 调用
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { BaseClient } from '../base';
import type { MergeRequest, Branch, Logger } from '../../types';
import { createHttpClient, HttpClient } from '../../utils/http-client';

const execAsync = promisify(exec);

// ============================================================
// 配置和类型
// ============================================================

export interface GitLabClientConfig {
  apiUrl: string;
  token: string;
  projectId: string;
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
// GitLab Client
// ============================================================

export class GitLabClient extends BaseClient {
  readonly name = 'GitLab';
  
  private client: HttpClient;
  private projectId: string;

  constructor(config: GitLabClientConfig, logger: Logger) {
    super(config.apiUrl, logger);
    this.projectId = config.projectId;
    
    this.client = createHttpClient({
      baseUrl: config.apiUrl,
      token: config.token,
      tokenLocation: 'private-token',
      timeout: 10000,
      allowSelfSignedCert: true,
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    try {
      await this.client.get('/user');
      return { healthy: true, message: 'Connected' };
    } catch (error) {
      return { healthy: false, message: (error as Error).message };
    }
  }

  // ============================================================
  // 分支操作
  // ============================================================

  async getBranches(): Promise<Branch[]> {
    const result = await this.client.get<GitLabBranchResponse[]>(
      `/projects/${this.projectId}/repository/branches`
    );
    return result.map(b => ({
      name: b.name,
      protected: b.protected,
      lastCommit: b.commit ? {
        id: b.commit.id,
        message: b.commit.message,
        author: b.commit.author_name,
        date: b.commit.created_at,
      } : undefined,
    }));
  }

  async createBranch(name: string, ref: string = 'main'): Promise<Branch> {
    const result = await this.client.post<GitLabBranchResponse>(
      `/projects/${this.projectId}/repository/branches`,
      { branch: name, ref }
    );
    return { name: result.name, protected: result.protected };
  }

  async pushBranch(name: string): Promise<boolean> {
    try {
      await execAsync(`git push origin ${name}`);
      this.logger.info(`[GitLab] Pushed branch: ${name}`);
      return true;
    } catch (err) {
      this.logger.error(`[GitLab] Push failed: ${(err as Error).message}`);
      return false;
    }
  }

  // ============================================================
  // Merge Request 操作
  // ============================================================

  async getMergeRequests(state?: 'open' | 'merged' | 'closed'): Promise<MergeRequest[]> {
    const params = state ? { state: state === 'open' ? 'opened' : state } : undefined;
    const result = await this.client.get<GitLabMergeRequestResponse[]>(
      `/projects/${this.projectId}/merge_requests`,
      params
    );
    return result.map(mr => this.mapMR(mr));
  }

  async createMergeRequest(sourceBranch: string, targetBranch: string, title: string): Promise<MergeRequest> {
    const result = await this.client.post<GitLabMergeRequestResponse>(
      `/projects/${this.projectId}/merge_requests`,
      {
        source_branch: sourceBranch,
        target_branch: targetBranch,
        title,
        remove_source_branch: true,
      }
    );
    this.logger.info(`[GitLab] Created MR: ${result.web_url}`);
    return this.mapMR(result);
  }

  async mergeMergeRequest(mrId: number): Promise<MergeRequest> {
    const result = await this.client.put<GitLabMergeRequestResponse>(
      `/projects/${this.projectId}/merge_requests/${mrId}/merge`
    );
    return this.mapMR(result);
  }

  async closeMergeRequest(mrId: number): Promise<void> {
    await this.client.put(
      `/projects/${this.projectId}/merge_requests/${mrId}`,
      { state_event: 'close' }
    );
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private mapMR(mr: GitLabMergeRequestResponse): MergeRequest {
    return {
      id: mr.iid,
      title: mr.title,
      description: mr.description,
      status: mr.state === 'merged' ? 'merged' : mr.state === 'closed' ? 'closed' : 'open',
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

export function createGitLabClient(config: GitLabClientConfig, logger: Logger): GitLabClient {
  return new GitLabClient(config, logger);
}