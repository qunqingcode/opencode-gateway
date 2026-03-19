/**
 * Provider 注册中心
 * 
 * 管理所有 Provider 的注册、发现和生命周期
 */

import {
  IProvider,
  IMessengerProvider,
  IIssueProvider,
  IRepositoryProvider,
  INotificationProvider,
  ProviderFactory,
} from './provider';
import {
  ProviderConfig,
  Logger,
  ProviderType,
  ProviderCapability,
} from './types';

// ============================================================
// 注册表
// ============================================================

/** Provider 构造器映射 */
const providerRegistry = new Map<string, ProviderFactory>();

/** Provider 类型映射 */
const providerTypeMap = new Map<string, ProviderType>();

/** Provider 能力映射 */
const providerCapabilityMap = new Map<string, ProviderCapability[]>();

// ============================================================
// 注册函数
// ============================================================

/**
 * 注册 Provider
 */
export function registerProvider(
  id: string,
  factory: ProviderFactory,
  type: ProviderType,
  capabilities: ProviderCapability[]
): void {
  if (providerRegistry.has(id)) {
    console.warn(`[Registry] Provider "${id}" already registered, overwriting`);
  }

  providerRegistry.set(id, factory);
  providerTypeMap.set(id, type);
  providerCapabilityMap.set(id, capabilities);

  console.log(`[Registry] Registered provider: ${id} (type: ${type}, capabilities: ${capabilities.join(', ')})`);
}

/**
 * 批量注册 Provider
 */
export function registerProviders(providers: Array<{
  id: string;
  factory: ProviderFactory;
  type: ProviderType;
  capabilities: ProviderCapability[];
}>): void {
  providers.forEach(({ id, factory, type, capabilities }) => {
    registerProvider(id, factory, type, capabilities);
  });
}

// ============================================================
// 创建函数
// ============================================================

/**
 * 创建 Provider 实例
 */
export function createProvider<T extends IProvider = IProvider>(
  id: string,
  config: ProviderConfig,
  logger: Logger
): T | null {
  const factory = providerRegistry.get(id);
  if (!factory) {
    logger.error(`[Registry] Provider "${id}" not found`);
    return null;
  }

  return factory(config, logger) as T;
}

/**
 * 创建指定类型的 Provider
 */
export function createMessengerProvider(
  id: string,
  config: ProviderConfig,
  logger: Logger
): IMessengerProvider | null {
  const provider = createProvider<IMessengerProvider>(id, config, logger);
  if (provider && !isMessengerProvider(provider)) {
    logger.error(`[Registry] Provider "${id}" is not a messenger provider`);
    return null;
  }
  return provider;
}

export function createIssueProvider(
  id: string,
  config: ProviderConfig,
  logger: Logger
): IIssueProvider | null {
  const provider = createProvider<IIssueProvider>(id, config, logger);
  if (provider && !isIssueProvider(provider)) {
    logger.error(`[Registry] Provider "${id}" is not an issue provider`);
    return null;
  }
  return provider;
}

export function createRepositoryProvider(
  id: string,
  config: ProviderConfig,
  logger: Logger
): IRepositoryProvider | null {
  const provider = createProvider<IRepositoryProvider>(id, config, logger);
  if (provider && !isRepositoryProvider(provider)) {
    logger.error(`[Registry] Provider "${id}" is not a repository provider`);
    return null;
  }
  return provider;
}

// ============================================================
// 查询函数
// ============================================================

/**
 * 获取已注册的 Provider ID 列表
 */
export function getRegisteredProviders(): string[] {
  return Array.from(providerRegistry.keys());
}

/**
 * 获取 Provider 类型
 */
export function getProviderType(id: string): ProviderType | undefined {
  return providerTypeMap.get(id);
}

/**
 * 获取 Provider 能力
 */
export function getProviderCapabilities(id: string): ProviderCapability[] {
  return providerCapabilityMap.get(id) || [];
}

/**
 * 检查 Provider 是否已注册
 */
export function hasProvider(id: string): boolean {
  return providerRegistry.has(id);
}

/**
 * 按类型获取 Provider 列表
 */
export function getProvidersByType(type: ProviderType): string[] {
  const result: string[] = [];
  providerTypeMap.forEach((t, id) => {
    if (t === type) result.push(id);
  });
  return result;
}

/**
 * 按能力获取 Provider 列表
 */
export function getProvidersByCapability(capability: ProviderCapability): string[] {
  const result: string[] = [];
  providerCapabilityMap.forEach((capabilities, id) => {
    if (capabilities.includes(capability)) result.push(id);
  });
  return result;
}

// ============================================================
// 类型守卫
// ============================================================

export function isMessengerProvider(provider: IProvider): provider is IMessengerProvider {
  return 'sendText' in provider && typeof (provider as IMessengerProvider).sendText === 'function';
}

export function isIssueProvider(provider: IProvider): provider is IIssueProvider {
  return 'getIssues' in provider && typeof (provider as IIssueProvider).getIssues === 'function';
}

export function isRepositoryProvider(provider: IProvider): provider is IRepositoryProvider {
  return 'createMergeRequest' in provider && typeof (provider as IRepositoryProvider).createMergeRequest === 'function';
}

export function isNotificationProvider(provider: IProvider): provider is INotificationProvider {
  return 'send' in provider && typeof (provider as INotificationProvider).send === 'function';
}

// ============================================================
// Provider 管理器
// ============================================================

/**
 * Provider 管理器
 * 
 * 管理多个 Provider 实例的生命周期
 */
export class ProviderManager {
  private providers = new Map<string, IProvider>();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * 添加 Provider
   */
  async add(id: string, provider: IProvider): Promise<void> {
    if (this.providers.has(id)) {
      this.logger.warn?.(`[ProviderManager] Provider "${id}" already exists, replacing`);
      await this.remove(id);
    }

    await provider.initialize(this.logger);
    this.providers.set(id, provider);
    this.logger.info(`[ProviderManager] Added provider: ${id}`);
  }

  /**
   * 移除 Provider
   */
  async remove(id: string): Promise<void> {
    const provider = this.providers.get(id);
    if (provider) {
      await provider.destroy();
      this.providers.delete(id);
      this.logger.info(`[ProviderManager] Removed provider: ${id}`);
    }
  }

  /**
   * 获取 Provider
   */
  get<T extends IProvider = IProvider>(id: string): T | undefined {
    return this.providers.get(id) as T | undefined;
  }

  /**
   * 获取指定类型的 Provider
   */
  getMessengerProvider(id: string): IMessengerProvider | undefined {
    const provider = this.providers.get(id);
    if (provider && isMessengerProvider(provider)) {
      return provider;
    }
    return undefined;
  }

  getIssueProvider(id: string): IIssueProvider | undefined {
    const provider = this.providers.get(id);
    if (provider && isIssueProvider(provider)) {
      return provider;
    }
    return undefined;
  }

  getRepositoryProvider(id: string): IRepositoryProvider | undefined {
    const provider = this.providers.get(id);
    if (provider && isRepositoryProvider(provider)) {
      return provider;
    }
    return undefined;
  }

  /**
   * 启动所有 Provider
   */
  async startAll(): Promise<Map<string, { stop: () => void }>> {
    const results = new Map<string, { stop: () => void }>();

    for (const [id, provider] of this.providers) {
      try {
        const result = await provider.start();
        results.set(id, result);
        this.logger.info(`[ProviderManager] Started provider: ${id}`);
      } catch (error) {
        this.logger.error(`[ProviderManager] Failed to start provider ${id}: ${(error as Error).message}`);
      }
    }

    return results;
  }

  /**
   * 健康检查所有 Provider
   * 并行执行，每个检查有 3 秒超时
   */
  async healthCheckAll(): Promise<Map<string, { healthy: boolean; message: string }>> {
    const results = new Map<string, { healthy: boolean; message: string }>();

    // 并行执行所有健康检查，每个最多等待 3 秒
    const checkPromises = Array.from(this.providers.entries()).map(async ([id, provider]) => {
      try {
        const result = await Promise.race([
          provider.healthCheck(),
          new Promise<{ healthy: false; message: string }>((resolve) =>
            setTimeout(() => resolve({ healthy: false, message: 'Health check timeout (3s)' }), 3000)
          ),
        ]);
        return { id, result };
      } catch (error) {
        return {
          id,
          result: {
            healthy: false,
            message: (error as Error).message,
          },
        };
      }
    });

    const checkResults = await Promise.all(checkPromises);
    for (const { id, result } of checkResults) {
      results.set(id, result);
    }

    return results;
  }

  /**
   * 获取所有 Provider 状态
   */
  getAllStatus(): Map<string, ReturnType<IProvider['getStatus']>> {
    const results = new Map<string, ReturnType<IProvider['getStatus']>>();

    for (const [id, provider] of this.providers) {
      results.set(id, provider.getStatus());
    }

    return results;
  }

  /**
   * 销毁所有 Provider
   */
  async destroyAll(): Promise<void> {
    for (const [id, provider] of this.providers) {
      try {
        await provider.destroy();
        this.logger.info(`[ProviderManager] Destroyed provider: ${id}`);
      } catch (error) {
        this.logger.error(`[ProviderManager] Failed to destroy provider ${id}: ${(error as Error).message}`);
      }
    }

    this.providers.clear();
  }

  /**
   * 获取 Provider 数量
   */
  get size(): number {
    return this.providers.size;
  }
}