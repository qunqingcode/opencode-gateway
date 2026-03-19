import { IMessengerProvider } from './core/provider';
import { gatewayContext } from './core/context';
import {
  createCodeChangeCard,
  createPermissionCard,
  createQuestionCard,
  uploadAndSendFile,
} from './providers/feishu';
import { chat } from './opencode';
import { extractFilePaths, resolveExistingFilePath } from './utils/file';
import { appLogger as logger } from './utils/logger';

interface QueueMessage {
  chatId: string;
  messageId: string;
  senderId: string;
  text: string;
}

interface ChatQueue {
  messages: QueueMessage[];
  isProcessing: boolean;
}

// 按 chatId 隔离的消息队列
const chatQueues = new Map<string, ChatQueue>();
const MAX_QUEUE_SIZE = 100;

/**
 * 接收新消息，加入队列并触发处理
 */
export function enqueueMessage(chatId: string, messageId: string, senderId: string, text: string, provider: IMessengerProvider) {
  if (!chatQueues.has(chatId)) {
    chatQueues.set(chatId, { messages: [], isProcessing: false });
  }
  const queue = chatQueues.get(chatId)!;

  // 防刷屏机制
  if (queue.messages.length >= MAX_QUEUE_SIZE) {
    logger.warn(`[Queue] 队列已满，丢弃消息: ${messageId}`);
    return;
  }

  queue.messages.push({ chatId, messageId, senderId, text });

  // 触发队列处理
  processMessageQueue(chatId, provider).catch(err => {
    logger.error(`[Queue] 处理异常: ${err}`);
  });
}

/**
 * 处理消息队列
 * 防止同一会话中消息乱序
 */
async function processMessageQueue(chatId: string, provider: IMessengerProvider): Promise<void> {
  const queue = chatQueues.get(chatId);
  if (!queue || queue.isProcessing || queue.messages.length === 0) return;

  queue.isProcessing = true;

  try {
    while (queue.messages.length > 0) {
      const msg = queue.messages.shift();
      if (!msg) continue;

      const { messageId, senderId, text } = msg;

      try {
        logger.info(`[开始处理] ${text.substring(0, 50)}...`);

        // Call OpenCode AI with all callbacks
        const result = await chat(
          text,
          chatId,
          {
            // Permission callback
            onPermission: async (chatId, permission) => {
              logger.info(`[Permission] ${permission.type}: ${permission.id}`);
              gatewayContext.setPendingRequest(permission.id, { chatId, senderId, messageId });

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

              if (provider.sendCard) {
                try {
                  await provider.sendCard(chatId, card);
                  logger.info(`[Permission] Card sent`);
                } catch (err) {
                  logger.error(`[Permission] Failed to send card: ${(err as Error).message}`);
                }
              }
            },
            // Question callback
            onQuestion: async (chatId, question) => {
              logger.info(`[Question] ${question.id}`);
              gatewayContext.setPendingRequest(question.id, { chatId, senderId, messageId });

              const card = createQuestionCard({
                operatorOpenId: senderId,
                chatId,
                question: {
                  id: question.id,
                  questions: question.questions,
                },
              });

              if (provider.sendCard) {
                try {
                  await provider.sendCard(chatId, card);
                  logger.info(`[Question] Card sent`);
                } catch (err) {
                  logger.error(`[Question] Failed to send card: ${(err as Error).message}`);
                }
              }
            },
            // Code change callback
            onCodeChange: async (chatId, codeChange) => {
              logger.info(`[CodeChange] ========== CALLBACK TRIGGERED ==========`);
              logger.info(`[CodeChange] ID: ${codeChange.id}`);
              gatewayContext.setPendingRequest(codeChange.id, { chatId, senderId, messageId });

              const card = createCodeChangeCard({
                operatorOpenId: senderId,
                chatId,
                branchName: codeChange.branchName,
                summary: codeChange.summary,
                changelog: codeChange.changelog || codeChange.files.map(f => `- ${f}`).join('\n'),
                files: codeChange.files,
                docUrl: codeChange.docUrl,
              });

              if (provider.sendCard) {
                try {
                  await provider.sendCard(chatId, card);
                  logger.info(`[CodeChange] Card sent successfully!`);
                } catch (err) {
                  logger.error(`[CodeChange] Failed to send card: ${(err as Error).message}`);
                }
              }
            }
          }
        );

        // Handle result
        logger.info(`[Result] Type: ${result.type}`);
        if (result.type === 'response') {
          await replyWithFiles(chatId, result.data as string, messageId, provider);
        }
      } catch (error) {
        logger.error('[处理失败]', error);
        await provider.sendText(chatId, `❌ 处理出错: ${(error as Error).message}`, messageId);
      }
    }
  } finally {
    // 确保锁一定被释放
    queue.isProcessing = false;
    // 队列空了，清理掉以释放内存
    if (queue.messages.length === 0) {
      chatQueues.delete(chatId);
    }
  }
}

/**
 * 回复消息（支持文本、图片和文件）
 */
async function replyWithFiles(
  chatId: string,
  text: string,
  messageId: string,
  provider: IMessengerProvider
): Promise<void> {
  try {
    // 1. 先回复文本
    if (text.trim()) {
      await provider.sendText(chatId, text, messageId);
    }

    // 2. 检测并发送文件
    const filePaths = extractFilePaths(text);
    if (filePaths.length === 0) return;

    const feishuClient = gatewayContext.getFeishuClient();
    if (!feishuClient) {
      logger.warn('[文件上传] Feishu client 未初始化');
      return;
    }

    for (const filePath of filePaths) {
      const foundPath = resolveExistingFilePath(filePath);
      if (foundPath) {
        await uploadAndSendFile(feishuClient, foundPath, chatId, messageId, {
          info: (msg) => logger.info(msg),
          error: (msg) => logger.error(msg),
        });
      } else {
        logger.debug(`[DEBUG] 未找到文件 (原始路径: ${filePath})`);
      }
    }
  } catch (error) {
    logger.error('[回复失败]', error);
  }
}
