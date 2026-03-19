/**
 * OpenCode Gateway Main Entry
 * 
 * Plugin-based architecture, supports multiple platforms:
 * - Feishu/Lark (Messaging)
 * - GitLab (Code Repository)
 * - Zentao (Issue Tracking)
 * - More platforms can be extended...
 * 
 * Features:
 * - 消息队列机制：防止同一会话消息乱序
 * - 文件上传：自动上传 AI 生成的文件
 * - 权限确认：通过卡片交互确认敏感操作
 * - 问题确认：通过卡片交互获取用户选择
 * - 代码修改：自动创建 MR 审批流程
 */

// ============================================================
// Module Imports
// ============================================================

import { CONFIG, validateConfig, getEnabledProviders } from './src/config';
import { ProviderManager, registerProvider } from './src/core/registry';
import { IMessengerProvider, IRepositoryProvider } from './src/core/provider';
import {
  FeishuProvider,
  createFeishuProvider,
  FeishuConfig,
  createCodeChangeCard,
  createPermissionCard,
  createQuestionCard,
  createCardActionHandler,
  CardActionCallbacks,
  uploadAndSendFile,
} from './src/providers/feishu';
import { GitLabProvider, createGitLabProvider, GitLabConfig } from './src/providers/gitlab';
import { ZentaoProvider, createZentaoProvider, ZentaoConfig } from './src/providers/zentao';
import {
  init,
  preInit,
  chat,
  continueAfterReply,
  replyPermission,
  replyQuestion,
  rejectQuestion,
} from './src/opencode';
import { gatewayContext } from './src/core/context';
import { enqueueMessage } from './src/queue';
import { appLogger as logger } from './src/utils/logger';

// ============================================================
// Provider Registration
// ============================================================

registerProvider('feishu', (config, logger) => createFeishuProvider(config as FeishuConfig, logger), 'messenger', ['messaging', 'media', 'notification']);
registerProvider('gitlab', (config, logger) => createGitLabProvider(config as GitLabConfig, logger), 'vcs', ['repository']);
registerProvider('zentao', (config, logger) => createZentaoProvider(config as ZentaoConfig, logger), 'issue', ['issues', 'project']);

// ============================================================
// Main Function
// ============================================================

async function main() {
  validateConfig();

  logger.info('========================================');
  logger.info('  OpenCode Gateway v2.4');
  logger.info('  + 消息队列机制');
  logger.info('  + 文件自动上传');
  logger.info('  + 全局 Session 策略');
  logger.info('  + Permission/Question 卡片交互');
  logger.info('  + 代码修改 MR 审批流程');
  logger.info('  + 模块化架构重构');
  logger.info('========================================');

  // Pre-initialize OpenCode SDK
  logger.info('[Startup] Pre-initializing OpenCode SDK...');
  await preInit();
  logger.info('[Startup] SDK ready');

  const manager = new ProviderManager(logger);
  gatewayContext.setProviderManager(manager);

  const enabledProviders = getEnabledProviders();
  logger.info(`Found ${enabledProviders.length} enabled provider(s)`);

  for (const providerConfig of enabledProviders) {
    try {
      let provider;

      switch (providerConfig.id) {
        case 'feishu':
          provider = createFeishuProvider(providerConfig as FeishuConfig, logger);
          break;
        case 'gitlab':
          provider = createGitLabProvider(providerConfig as GitLabConfig, logger);
          break;
        case 'zentao':
          provider = createZentaoProvider(providerConfig as ZentaoConfig, logger);
          break;
        default:
          logger.warn(`Unknown provider: ${providerConfig.id}`);
          continue;
      }

      if (provider) {
        await manager.add(providerConfig.id, provider);

        if (providerConfig.id === 'feishu') {
          const feishuProvider = manager.getMessengerProvider('feishu') as FeishuProvider;
          if (feishuProvider) {
            // 获取飞书 client 用于文件上传
            const client = feishuProvider.getClient();
            if (client) {
              gatewayContext.setFeishuClient(client);
            }

            // 设置消息处理器
            feishuProvider.onMessage(async (event) => {
              const { chatId, messageId, senderId } = event.source;
              const text = event.content.text || '';
              
              // 将消息加入队列
              enqueueMessage(chatId, messageId, senderId, text, feishuProvider);
            });

            // 设置卡片交互处理器
            if (feishuProvider.onInteraction) {
              const cardActionCallbacks: CardActionCallbacks = {
                replyPermission,
                replyQuestion,
                rejectQuestion,
                continueAfterReply: async (chatId) => {
                  const result = await continueAfterReply(chatId);
                  return {
                    type: result.type,
                    data: result.data,
                  };
                },
                createMR: async (sourceBranch, targetBranch, title) => {
                  const gitlab = gatewayContext.getGitLabProvider();
                  if (!gitlab) {
                    throw new Error('GitLab provider not configured');
                  }
                  return gitlab.createMergeRequest(sourceBranch, targetBranch, title);
                },
                getChatId: (requestId) => gatewayContext.getChatId(requestId),
              };

              const handleCardAction = createCardActionHandler(cardActionCallbacks, logger);

              feishuProvider.onInteraction(async (event) => {
                return handleCardAction({
                  provider: event.provider,
                  action: event.action,
                  value: event.value,
                  messageId: event.messageId,
                  userId: event.userId,
                });
              });
            }
          }
        }

        if (providerConfig.id === 'gitlab') {
          gatewayContext.setGitLabProvider(provider as IRepositoryProvider);
          logger.info('[GitLab] Provider saved for MR creation');
        }
      }
    } catch (error) {
      logger.error(`Failed to initialize provider ${providerConfig.id}: ${(error as Error).message}`);
    }
  }

  const stopFns = await manager.startAll();

  logger.info('========================================');
  logger.info(`  Providers: ${manager.size}`);
  logger.info(`  OpenCode: ${CONFIG.opencode.url}`);
  logger.info('========================================');

  const healthResults = await manager.healthCheckAll();
  healthResults.forEach((result, id) => {
    const status = result.healthy ? 'OK' : 'FAIL';
    logger.info(`  [${status}] ${id}: ${result.message}`);
  });

  const shutdown = async () => {
    logger.info('Shutting down...');
    await manager.destroyAll();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (err) => logger.error('Uncaught exception:', err));
  process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection:', reason));
}

// ============================================================
// Startup
// ============================================================

main().catch((err) => {
  logger.error('Startup failed:', err);
  process.exit(1);
});