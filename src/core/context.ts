/**
 * Gateway 上下文
 * 
 * 职责：管理跨模块的 Provider 引用
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import { IRepositoryProvider, IIssueProvider } from './provider';
import { ProviderManager } from './registry';

export class GatewayContext {
  /** GitLab Provider (用于创建 MR) */
  private gitlabProvider: IRepositoryProvider | null = null;

  /** 禅道 Provider (用于问题管理) */
  private zentaoProvider: IIssueProvider | null = null;

  /** 飞书客户端 (用于文件上传) */
  private feishuClient: InstanceType<typeof Lark.Client> | null = null;

  /** Provider 管理器 */
  private providerManager: ProviderManager | null = null;

  // ============================================================
  // GitLab Provider
  // ============================================================

  setGitLabProvider(provider: IRepositoryProvider): void {
    this.gitlabProvider = provider;
  }

  getGitLabProvider(): IRepositoryProvider | null {
    return this.gitlabProvider;
  }

  // ============================================================
  // 禅道 Provider
  // ============================================================

  setZentaoProvider(provider: IIssueProvider): void {
    this.zentaoProvider = provider;
  }

  getZentaoProvider(): IIssueProvider | null {
    return this.zentaoProvider;
  }

  // ============================================================
  // 飞书客户端
  // ============================================================

  setFeishuClient(client: InstanceType<typeof Lark.Client> | null): void {
    this.feishuClient = client;
  }

  getFeishuClient(): InstanceType<typeof Lark.Client> | null {
    return this.feishuClient;
  }

  // ============================================================
  // Provider 管理器
  // ============================================================

  setProviderManager(manager: ProviderManager): void {
    this.providerManager = manager;
  }

  getProviderManager(): ProviderManager | null {
    return this.providerManager;
  }
}

export const gatewayContext = new GatewayContext();