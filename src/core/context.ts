import * as Lark from '@larksuiteoapi/node-sdk';
import { IRepositoryProvider } from './provider';
import { ProviderManager } from './registry';

/**
 * Gateway 上下文
 * 管理跨模块的状态和依赖
 */
export class GatewayContext {
  /** 待处理请求映射 (requestId -> chatId, senderId, messageId) */
  private pendingRequests = new Map<string, { chatId: string; senderId: string; messageId: string }>();

  /** GitLab Provider (用于创建 MR) */
  private gitlabProvider: IRepositoryProvider | null = null;

  /** 飞书客户端 (用于文件上传) */
  private feishuClient: InstanceType<typeof Lark.Client> | null = null;

  /** Provider 管理器 */
  private providerManager: ProviderManager | null = null;

  setGitLabProvider(provider: IRepositoryProvider): void {
    this.gitlabProvider = provider;
  }

  getGitLabProvider(): IRepositoryProvider | null {
    return this.gitlabProvider;
  }

  setFeishuClient(client: InstanceType<typeof Lark.Client> | null): void {
    this.feishuClient = client;
  }

  getFeishuClient(): InstanceType<typeof Lark.Client> | null {
    return this.feishuClient;
  }

  setProviderManager(manager: ProviderManager): void {
    this.providerManager = manager;
  }

  getProviderManager(): ProviderManager | null {
    return this.providerManager;
  }

  // Pending requests
  setPendingRequest(requestId: string, data: { chatId: string; senderId: string; messageId: string }): void {
    this.pendingRequests.set(requestId, data);
  }

  getPendingRequest(requestId: string): { chatId: string; senderId: string; messageId: string } | undefined {
    return this.pendingRequests.get(requestId);
  }

  getChatId(requestId: string): string {
    const pending = this.pendingRequests.get(requestId);
    return pending?.chatId || '';
  }

  deletePendingRequest(requestId: string): void {
    this.pendingRequests.delete(requestId);
  }
}

// 全局上下文实例
export const gatewayContext = new GatewayContext();
