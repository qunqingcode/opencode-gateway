/**
 * 运行时模块
 * 
 * 职责：
 * 1. 消息处理调度：用户消息 → AI → 回复/指令
 * 2. 卡片交互调度：用户操作 → 指令处理
 * 3. 依赖注入：组装 CardBuilder 和 CommandServices
 * 
 * 不再包含具体业务逻辑，所有业务逻辑已迁移到 Command 层
 */

import { IMessengerProvider, IRepositoryProvider, setMessageHandler, MessageHandler, requestRegistry } from '../core';
import {
  chat,
  continueAfterReply,
  type CodeChangeRequest,
  type PermissionRequest,
  type QuestionRequest,
} from '../providers/opencode';
import {
  getCommandPipeline,
  setupCommands,
  createPermissionCommand,
  createQuestionCommand,
  type CommandContext,
  type InteractionEnvelope,
  type CardBuilder,
  type CommandServices,
} from '../commands';
import { getFeishuCardBuilder } from '../providers/feishu/card';
import { extractFilePaths, resolveExistingFilePath } from '../utils/file';
import { uploadAndSendFile } from '../providers/feishu';
import { gatewayContext } from '../core';
import { appLogger as logger } from '../utils/logger';

// ============================================================
// 辅助函数
// ============================================================

/**
 * 发送卡片并记录请求
 */
async function sendCard(
  provider: IMessengerProvider,
  meta: { requestId: string; chatId: string; senderId: string; messageId: string },
  card: unknown
): Promise<void> {
  logger.info(`[Card] requestId=${meta.requestId}, chatId=${meta.chatId}, senderId=${meta.senderId}`);
  requestRegistry.set(meta.requestId, {
    chatId: meta.chatId,
    senderId: meta.senderId,
    messageId: meta.messageId,
  });

  if (provider.sendCard) {
    await provider.sendCard(meta.chatId, card);
    logger.info('[Card] Sent');
  }
}

/**
 * 构建 CommandContext
 */
function buildCommandContext(
  chatId: string,
  userId: string,
  messageId: string,
  provider: IMessengerProvider,
  gitlabProvider: IRepositoryProvider | null,
  senderId?: string
): CommandContext {
  const pipeline = getCommandPipeline();

  return {
    chatId,
    userId,
    messageId,
    senderId,
    cardBuilder: pipeline.cardBuilder,
    messenger: {
      sendText: async (chatId, text, replyToId) => {
        await provider.sendText(chatId, text, replyToId);
      },
      sendCard: provider.sendCard
        ? async (chatId, card) => {
            if (provider.sendCard) {
              await provider.sendCard(chatId, card);
            }
          }
        : undefined,
    },
    services: pipeline.services,
  };
}

// ============================================================
// 消息处理
// ============================================================

/**
 * 创建消息处理器
 */
export function createMessageHandler(
  provider: IMessengerProvider,
  gitlabProvider: IRepositoryProvider | null
): MessageHandler {
  return async (chatId, messageId, senderId, text) => {
    try {
      logger.info(`[Message] Processing: ${text.substring(0, 50)}...`);

      const result = await chat(text, chatId, {
        onPermission: (_, permission) =>
          handlePermissionRequest(chatId, senderId, messageId, permission, provider),

        onQuestion: (_, question) =>
          handleQuestionRequest(chatId, senderId, messageId, question, provider),

        onCodeChange: (_, codeChange) =>
          handleCodeChangeRequest(chatId, senderId, messageId, codeChange, provider),
      });

      if (result.type === 'response') {
        await replyWithFiles(chatId, result.data as string, messageId, provider);
      }

    } catch (error) {
      logger.error('[Message] Processing failed:', error);
      await provider.sendText(chatId, `❌ 处理出错: ${(error as Error).message}`, messageId);
    }
  };
}

/**
 * 处理权限请求
 */
async function handlePermissionRequest(
  chatId: string,
  senderId: string,
  messageId: string,
  permission: PermissionRequest,
  provider: IMessengerProvider
): Promise<void> {
  const pipeline = getCommandPipeline();
  const command = createPermissionCommand({
    id: permission.id,
    type: permission.type,
    title: permission.title,
    pattern: permission.pattern,
    metadata: permission.metadata,
  });

  const context = buildCommandContext(chatId, senderId, messageId, provider, null, senderId);
  const card = await pipeline.buildCard(command, context);

  if (card) {
    await sendCard(provider, {
      requestId: permission.id,
      chatId,
      senderId,
      messageId,
    }, card);
  }
}

/**
 * 处理问题请求
 */
async function handleQuestionRequest(
  chatId: string,
  senderId: string,
  messageId: string,
  question: QuestionRequest,
  provider: IMessengerProvider
): Promise<void> {
  const pipeline = getCommandPipeline();
  const command = createQuestionCommand({
    id: question.id,
    questions: question.questions,
  });

  const context = buildCommandContext(chatId, senderId, messageId, provider, null, senderId);
  const card = await pipeline.buildCard(command, context);

  if (card) {
    await sendCard(provider, {
      requestId: question.id,
      chatId,
      senderId,
      messageId,
    }, card);
  }
}

/**
 * 处理代码修改请求
 */
async function handleCodeChangeRequest(
  chatId: string,
  senderId: string,
  messageId: string,
  codeChange: CodeChangeRequest,
  provider: IMessengerProvider
): Promise<void> {
  const pipeline = getCommandPipeline();

  // 通过 pipeline 提取指令
  const command = pipeline.extractCommand(JSON.stringify({
    action: 'code_change',
    branchName: codeChange.branchName,
    summary: codeChange.summary,
    files: codeChange.files,
    changelog: codeChange.changelog,
    docUrl: codeChange.docUrl,
  }));

  if (command) {
    const context = buildCommandContext(chatId, senderId, messageId, provider, null, senderId);
    const card = await pipeline.buildCard(command, context);

    if (card) {
      await sendCard(provider, {
        requestId: command.id,
        chatId,
        senderId,
        messageId,
      }, card);
    }
  }
}

/**
 * 回复消息（支持文本和文件）
 */
async function replyWithFiles(
  chatId: string,
  text: string,
  messageId: string,
  provider: IMessengerProvider
): Promise<void> {
  if (text.trim()) {
    await provider.sendText(chatId, text, messageId);
  }

  const filePaths = extractFilePaths(text);
  if (filePaths.length === 0) return;

  const feishuClient = gatewayContext.getFeishuClient();
  if (!feishuClient) {
    logger.warn('[Reply] Feishu client not available');
    return;
  }

  for (const filePath of filePaths) {
    const foundPath = resolveExistingFilePath(filePath);
    if (foundPath) {
      await uploadAndSendFile(feishuClient, foundPath, chatId, messageId, {
        info: (msg) => logger.info(msg),
        error: (msg) => logger.error(msg),
      });
    }
  }
}

// ============================================================
// 卡片交互处理
// ============================================================

/**
 * 创建卡片交互处理器
 */
export function createCardHandler(
  messengerProvider: IMessengerProvider,
  gitlabProvider: IRepositoryProvider | null
) {
  return async (event: {
    provider: string;
    action: string;
    value: Record<string, unknown>;
    messageId: string;
    userId: string;
  }): Promise<{ toast?: { type: string; content: string }; card?: unknown }> => {
    const pipeline = getCommandPipeline();

    logger.info(`[CardHandler] action=${event.action}, value=${JSON.stringify(event.value).slice(0, 200)}`);

    // 检查是否是指令层能处理的动作
    if (!pipeline.canHandleAction(event.action)) {
      logger.warn(`[CardHandler] Unknown action: ${event.action}`);
      return { toast: { type: 'info', content: '已处理' } };
    }

    // 构建交互信封
    const envelope: InteractionEnvelope = {
      action: event.action,
      value: event.value,
      metadata: event.value,
    };

    // 从信封上下文中获取 chatId
    // 信封格式: { oc: 'ocf1', k: 'quick', a: 'code_change.create_mr', c: { h: 'chatId', ... } }
    const contextData = event.value?.c as Record<string, unknown> | undefined;
    const chatId = contextData?.h as string | undefined;

    if (!chatId) {
      // 尝试从 requestRegistry 获取（旧逻辑兜底）
      const requestId = event.action.split('.')[2];
      const fallbackChatId = requestRegistry.getChatId(requestId);
      
      if (!fallbackChatId) {
        return { toast: { type: 'error', content: '请求已过期' } };
      }
      
      const cmdContext = buildCommandContext(
        fallbackChatId,
        event.userId,
        event.messageId,
        messengerProvider,
        gitlabProvider
      );
      return pipeline.handleInteraction(event.action, envelope, cmdContext);
    }

    const cmdContext = buildCommandContext(
      chatId,
      event.userId,
      event.messageId,
      messengerProvider,
      gitlabProvider
    );

    return pipeline.handleInteraction(event.action, envelope, cmdContext);
  };
}

// ============================================================
// 初始化
// ============================================================

/**
 * 初始化运行时
 */
export function setupRuntime(
  messengerProvider: IMessengerProvider,
  gitlabProvider: IRepositoryProvider | null
): void {
  // 1. 创建卡片构建器
  const cardBuilder = getFeishuCardBuilder();

  // 2. 构建服务依赖
  const services: CommandServices = {
    opencode: {
      replyPermission: async (requestId, reply) => {
        const { replyPermission } = await import('../providers/opencode/index.js');
        return replyPermission(requestId, reply);
      },
      replyQuestion: async (requestId, answers) => {
        const { replyQuestion } = await import('../providers/opencode/index.js');
        return replyQuestion(requestId, answers);
      },
      rejectQuestion: async (requestId) => {
        const { rejectQuestion } = await import('../providers/opencode/index.js');
        return rejectQuestion(requestId);
      },
      continueAfterReply: async (chatId) => {
        const result = await continueAfterReply(chatId);
        return { type: result.type, data: result.data };
      },
    },
    registry: {
      getChatId: (requestId) => requestRegistry.getChatId(requestId),
    },
    repository: gitlabProvider
      ? {
          createMergeRequest: async (sourceBranch, targetBranch, title) => {
            const mr = await gitlabProvider.createMergeRequest(sourceBranch, targetBranch, title);
            return { url: mr.url };
          },
        }
      : undefined,
  };

  // 3. 初始化指令层
  setupCommands(cardBuilder, services);

  // 4. 注册消息处理器
  const messageHandler = createMessageHandler(messengerProvider, gitlabProvider);
  setMessageHandler(messageHandler);

  // 5. 注册卡片交互处理器
  const cardHandler = createCardHandler(messengerProvider, gitlabProvider);
  if (messengerProvider.onInteraction) {
    messengerProvider.onInteraction(async (event) => {
      return cardHandler({
        provider: event.provider,
        action: event.action,
        value: event.value,
        messageId: event.messageId,
        userId: event.userId,
      });
    });
  }

  logger.info('[Runtime] Setup complete');
}