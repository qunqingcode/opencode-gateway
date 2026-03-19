/**
 * OpenCode Gateway 主入口
 * 
 * 职责：启动服务 + 编排各模块
 */

import { CONFIG, validateConfig, getEnabledProviders } from './src/config';
import {
  ProviderManager,
  registerProvider,
  createProvider,
  gatewayContext,
  enqueueMessage,
} from './src/core';
import { IMessengerProvider, IRepositoryProvider } from './src/core';
import { preInit } from './src/providers/opencode';
import {
  FeishuProvider,
  createFeishuProvider,
  FeishuConfig,
} from './src/providers/feishu';
import {
  createGitLabProvider,
  GitLabConfig,
} from './src/providers/gitlab';
import {
  createZentaoProvider,
  ZentaoConfig,
} from './src/providers/zentao';
import { setupOrchestrator } from './src/orchestrator';
import { appLogger as logger } from './src/utils/logger';

// ============================================================
// Provider 注册
// ============================================================

registerProvider(
  'feishu',
  (config, log) => createFeishuProvider(config as FeishuConfig, log),
  'messenger',
  ['messaging', 'media', 'notification']
);

registerProvider(
  'gitlab',
  (config, log) => createGitLabProvider(config as GitLabConfig, log),
  'vcs',
  ['repository']
);

registerProvider(
  'zentao',
  (config, log) => createZentaoProvider(config as ZentaoConfig, log),
  'issue',
  ['issues', 'project']
);

// ============================================================
// 主函数
// ============================================================

async function main() {
  validateConfig();

  logger.info('========================================');
  logger.info('  OpenCode Gateway v2.5');
  logger.info('  + 模块化架构');
  logger.info('  + 流程编排分离');
  logger.info('========================================');

  // 1. 初始化 OpenCode SDK
  logger.info('[Startup] Initializing OpenCode SDK...');
  await preInit();
  logger.info('[Startup] SDK ready');

  // 2. 创建 Provider 管理器
  const manager = new ProviderManager(logger);
  gatewayContext.setProviderManager(manager);

  // 3. 初始化各 Provider
  const enabledProviders = getEnabledProviders();
  logger.info(`[Startup] Found ${enabledProviders.length} provider(s)`);

  let feishuProvider: IMessengerProvider | null = null;
  let gitlabProvider: IRepositoryProvider | null = null;

  for (const providerConfig of enabledProviders) {
    try {
      // 使用 registry 的 createProvider 替代 switch-case
      const provider = createProvider(providerConfig.id, providerConfig, logger);
      if (!provider) continue;

      await manager.add(providerConfig.id, provider);

      // 记录关键 Provider 引用
      if (providerConfig.id === 'feishu') {
        feishuProvider = manager.getMessengerProvider('feishu') as FeishuProvider;
        if (feishuProvider) {
          const client = (feishuProvider as FeishuProvider).getClient?.();
          if (client) {
            gatewayContext.setFeishuClient(client);
          }
        }
      }

      if (providerConfig.id === 'gitlab') {
        gitlabProvider = provider as IRepositoryProvider;
        gatewayContext.setGitLabProvider(gitlabProvider);
      }
    } catch (error) {
      logger.error(`[Startup] Failed to init ${providerConfig.id}:`, (error as Error).message);
    }
  }

  // 4. 设置流程编排
  if (feishuProvider) {
    feishuProvider.onMessage(async (event) => {
      const { chatId, messageId, senderId } = event.source;
      const text = event.content.text || '';
      enqueueMessage(chatId, messageId, senderId, text, feishuProvider!);
    });

    setupOrchestrator(feishuProvider, gitlabProvider);
  }

  // 5. 启动所有 Provider
  await manager.startAll();

  logger.info('========================================');
  logger.info(`  Providers: ${manager.size}`);
  logger.info(`  OpenCode: ${CONFIG.opencode.url}`);
  logger.info('========================================');

  // 6. 健康检查
  const healthResults = await manager.healthCheckAll();
  healthResults.forEach((result, id) => {
    const status = result.healthy ? 'OK' : 'FAIL';
    logger.info(`  [${status}] ${id}: ${result.message}`);
  });

  // 7. 优雅关闭
  const shutdown = async () => {
    logger.info('[Shutdown] Stopping...');
    await manager.destroyAll();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (err) => logger.error('[Error] Uncaught:', err));
  process.on('unhandledRejection', (reason) => logger.error('[Error] Unhandled:', reason));
}

// ============================================================
// 启动
// ============================================================

main().catch((err) => {
  logger.error('[Startup] Failed:', err);
  process.exit(1);
});