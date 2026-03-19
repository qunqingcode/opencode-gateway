/**
 * 消息队列引擎
 * 
 * 职责：按 chatId 隔离的消息队列，防止乱序
 */

import { IMessengerProvider } from './provider';
import { appLogger as logger } from '../utils/logger';

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

/** 消息处理器类型 */
export type MessageHandler = (
  chatId: string,
  messageId: string,
  senderId: string,
  text: string,
  provider: IMessengerProvider
) => Promise<void>;

// 按 chatId 隔离的消息队列
const chatQueues = new Map<string, ChatQueue>();
const MAX_QUEUE_SIZE = 100;

/** 消息处理器（由 orchestrator 设置） */
let messageHandler: MessageHandler | null = null;

/**
 * 设置消息处理器
 */
export function setMessageHandler(handler: MessageHandler): void {
  messageHandler = handler;
}

/**
 * 消息入队
 * 
 * @param chatId 会话 ID
 * @param messageId 消息 ID
 * @param senderId 发送者 ID
 * @param text 消息文本
 * @param provider 消息提供者
 */
export function enqueueMessage(
  chatId: string,
  messageId: string,
  senderId: string,
  text: string,
  provider: IMessengerProvider
): void {
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
  processQueue(chatId, provider).catch(err => {
    logger.error(`[Queue] 处理异常:`, err);
  });
}

/**
 * 处理消息队列
 */
async function processQueue(chatId: string, provider: IMessengerProvider): Promise<void> {
  const queue = chatQueues.get(chatId);
  if (!queue || queue.isProcessing || queue.messages.length === 0) return;
  if (!messageHandler) {
    logger.warn('[Queue] 消息处理器未设置');
    return;
  }

  queue.isProcessing = true;

  try {
    while (queue.messages.length > 0) {
      const msg = queue.messages.shift();
      if (!msg) continue;

      await messageHandler(msg.chatId, msg.messageId, msg.senderId, msg.text, provider);
    }
  } finally {
    queue.isProcessing = false;
    
    // 队列空了，清理掉以释放内存
    if (queue.messages.length === 0) {
      chatQueues.delete(chatId);
    }
  }
}

/**
 * 获取队列统计信息
 */
export function getQueueStats(): { totalQueues: number; totalMessages: number } {
  let totalMessages = 0;
  for (const queue of chatQueues.values()) {
    totalMessages += queue.messages.length;
  }
  return {
    totalQueues: chatQueues.size,
    totalMessages,
  };
}