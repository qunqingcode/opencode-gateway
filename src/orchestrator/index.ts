/**
 * 流程编排模块
 * 
 * 职责：
 * 1. 消息处理流程（用户消息 → AI → 回复/卡片）
 * 2. 卡片交互流程（审批 → 继续 AI 处理）
 * 3. 业务逻辑绑定（Provider 之间的协作）
 */

import { IMessengerProvider, IRepositoryProvider, gatewayContext, setMessageHandler, MessageHandler, requestRegistry } from '../core';
import {
  chat,
  continueAfterReply,
  replyPermission,
  replyQuestion,
  rejectQuestion,
} from '../providers/opencode';
import type { CodeChangeRequest, PermissionRequest, QuestionRequest } from '../providers/opencode';
import {
  createCodeChangeCard,
  createPermissionCard,
  createQuestionCard,
  createCardActionHandler,
  CardActionCallbacks,
  uploadAndSendFile,
} from '../providers/feishu';
import { extractFilePaths, resolveExistingFilePath } from '../utils/file';
import { appLogger as logger } from '../utils/logger';

// ============================================================
// 配置
// ============================================================

const DEFAULT_TARGET_BRANCH = 'develop';

// ============================================================
// 通用函数
// ============================================================

interface RequestMeta {
  requestId: string;
  chatId: string;
  senderId: string;
  messageId: string;
}

/**
 * 发送卡片并记录请求
 */
async function sendCard(
  provider: IMessengerProvider,
  meta: RequestMeta,
  card: unknown,
  logLabel: string
): Promise<void> {
  logger.info(`[${logLabel}] ${meta.requestId}`);
  requestRegistry.set(meta.requestId, {
    chatId: meta.chatId,
    senderId: meta.senderId,
    messageId: meta.messageId,
  });

  if (provider.sendCard) {
    await provider.sendCard(meta.chatId, card);
    logger.info(`[${logLabel}] Card sent`);
  }
}

// ============================================================
// 消息处理
// ============================================================

/**
 * 创建消息处理器
 */
export function createMessageHandler(provider: IMessengerProvider): MessageHandler {
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
  const card = createPermissionCard({
    operatorOpenId: senderId,
    chatId,
    permission: {
      id: permission.id,
      type: permission.type,
      title: permission.title,
      pattern: permission.pattern,
      metadata: permission.metadata,
    },
  });

  await sendCard(provider, {
    requestId: permission.id,
    chatId,
    senderId,
    messageId,
  }, card, 'Permission');
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
  const card = createQuestionCard({
    operatorOpenId: senderId,
    chatId,
    question: {
      id: question.id,
      questions: question.questions,
    },
  });

  await sendCard(provider, {
    requestId: question.id,
    chatId,
    senderId,
    messageId,
  }, card, 'Question');
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
  const card = createCodeChangeCard({
    operatorOpenId: senderId,
    chatId,
    branchName: codeChange.branchName,
    summary: codeChange.summary,
    changelog: codeChange.changelog || codeChange.files.map(f => `- ${f}`).join('\n'),
    files: codeChange.files,
    docUrl: codeChange.docUrl,
  });

  await sendCard(provider, {
    requestId: codeChange.id,
    chatId,
    senderId,
    messageId,
  }, card, 'CodeChange');
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
export function createCardHandler(gitlabProvider: IRepositoryProvider | null) {
  const callbacks: CardActionCallbacks = {
    replyPermission,
    replyQuestion,
    rejectQuestion,

    continueAfterReply: async (chatId) => {
      const result = await continueAfterReply(chatId);
      return { type: result.type, data: result.data };
    },

    createMR: async (sourceBranch, targetBranch, title) => {
      if (!gitlabProvider) {
        throw new Error('GitLab provider not configured');
      }
      return gitlabProvider.createMergeRequest(
        sourceBranch,
        targetBranch || DEFAULT_TARGET_BRANCH,
        title
      );
    },

    getChatId: (requestId) => requestRegistry.getChatId(requestId),
  };

  return createCardActionHandler(callbacks, logger);
}

// ============================================================
// 初始化
// ============================================================

/**
 * 初始化流程编排
 */
export function setupOrchestrator(
  messengerProvider: IMessengerProvider,
  gitlabProvider: IRepositoryProvider | null
): void {
  const messageHandler = createMessageHandler(messengerProvider);
  setMessageHandler(messageHandler);

  const cardHandler = createCardHandler(gitlabProvider);
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

  logger.info('[Orchestrator] Setup complete');
}