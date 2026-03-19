/**
 * 飞书消息接收模块
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import * as http from 'http';
import { createFeishuClient, addReaction } from './send';

// ============================================================
// 消息去重
// ============================================================

const processedMessageIds = new Set<string>();
const MAX_CACHE_SIZE = 1000;

function isDuplicate(messageId: string | undefined): boolean {
  if (!messageId) return true;
  if (processedMessageIds.has(messageId)) return true;
  
  processedMessageIds.add(messageId);
  
  // LRU 清理
  if (processedMessageIds.size > MAX_CACHE_SIZE) {
    const first = processedMessageIds.values().next().value;
    if (first) processedMessageIds.delete(first);
  }
  
  return false;
}

// ============================================================
// 类型定义
// ============================================================

export interface FeishuProviderOptions {
  account: {
    accountId: string;
    appId: string;
    appSecret: string;
    connectionMode?: 'websocket' | 'webhook';
    domain?: 'feishu' | 'lark';
    webhookPort?: number;
    webhookPath?: string;
    encryptKey?: string;
    verificationToken?: string;
    thinkingThresholdMs?: number;
    botNames?: string[];
  };
  log: {
    info: (msg: string) => void;
    error: (msg: string) => void;
    warn?: (msg: string) => void;
    debug?: (msg: string) => void;
  };
  statusSink?: (patch: Record<string, unknown>) => void;
  onMessage: (event: {
    chatId: string;
    messageId: string;
    text: string;
    senderId: string;
    chatType: 'p2p' | 'group';
    client: InstanceType<typeof Lark.Client>;
  }) => Promise<void>;
  onCardAction?: (event: {
    action: { value: Record<string, unknown> };
    open_message_id: string;
    open_id?: string;
  }) => Promise<unknown>;
}

function shouldRespondInGroup(
  text: string,
  mentions: Array<{ key: string }> | undefined,
  botNames?: string[]
): boolean {
  if (!text.trim()) return false;

  if (mentions && mentions.length > 0) {
    return true;
  }

  if (botNames && botNames.length > 0) {
    const lowerText = text.toLowerCase();
    for (const name of botNames) {
      if (lowerText.includes(name.toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}

// ============================================================
// 提供者启动
// ============================================================

export function startFeishuProvider(options: FeishuProviderOptions): { stop: () => void } {
  const { account, log, statusSink, onMessage, onCardAction } = options;

  const connectionMode = account.connectionMode || 'websocket';
  const domain = account.domain || 'feishu';

  const effectiveMode = domain === 'lark' && connectionMode === 'websocket' ? 'webhook' : connectionMode;

  log.info(`Starting ${effectiveMode} provider (domain=${domain})`);

  const client = createFeishuClient(account);

  // 消息处理器
  const messageHandler = async (data: Record<string, unknown>) => {
    try {
      const message = (data as { message?: Record<string, unknown> }).message;
      if (!message) return;

      const chatId = message.chat_id as string | undefined;
      if (!chatId) return;

      const messageId = message.message_id as string | undefined;
      if (isDuplicate(messageId)) return;

      // 忽略机器人消息
      const sender = (data as { sender?: { sender_type?: string } }).sender;
      if (sender?.sender_type !== 'user') return;

      // 只处理文本消息
      const messageType = message.message_type as string | undefined;
      if (messageType !== 'text' || !message.content) return;

      let text: string;
      try {
        const parsed = JSON.parse(message.content as string) as { text?: string };
        text = (parsed.text ?? '').trim();
      } catch {
        return;
      }

      // 群聊过滤
      const chatType = message.chat_type as string | undefined;
      if (chatType === 'group') {
        const mentions = Array.isArray(message.mentions) ? message.mentions : [];
        text = text.replace(/@_user_\d+\s*/g, '').trim();

        if (!shouldRespondInGroup(text, mentions, account.botNames)) {
          return;
        }
      }

      if (!text) return;

      statusSink?.({ lastInboundAt: Date.now() });

      const senderId = (sender as { sender_id?: { open_id?: string } }).sender_id?.open_id ?? '';

      log.info(`Received from ${senderId}: ${text.slice(0, 80)}`);

      // 发送 OK 表情确认收到消息
      if (messageId) {
        addReaction(client, messageId).then(result => {
          if (!result.success) {
            log.error(`Add reaction failed: ${result.error}`);
          } else {
            log.info(`Add reaction OK success`);
          }
        }).catch(err => {
          log.error(`Add reaction error: ${(err as Error).message}`);
        });
      }

      await onMessage({
        chatId,
        messageId: messageId || '',
        text,
        senderId,
        chatType: chatType === 'p2p' ? 'p2p' : 'group',
        client,
      });
    } catch (err) {
      log.error(`Message handler error: ${(err as Error).message}`);
    }
  };

  // 卡片处理器
  const cardHandler = async (data: Record<string, unknown>) => {
    try {
      if (!onCardAction) {
        return { toast: { type: 'info', content: '已处理' } };
      }

      const event = data as {
        action?: { value?: Record<string, unknown> | string };
        open_message_id?: string;
        open_id?: string;
        operator?: { open_id?: string };
      };

      // 飞书有时会将 value 作为 string 传递，需要解析
      let actionValue = event.action?.value || {};
      if (typeof actionValue === 'string') {
        try {
          actionValue = JSON.parse(actionValue);
        } catch (e) {
          log.error(`[CardHandler] Failed to parse action.value: ${actionValue}`);
        }
      }

      return await onCardAction({
        action: { value: actionValue as Record<string, unknown> },
        open_message_id: event.open_message_id || '',
        open_id: event.operator?.open_id || event.open_id,
      });
    } catch (err) {
      log.error(`Card handler error: ${(err as Error).message}`);
      return { toast: { type: 'error', content: '处理失败' } };
    }
  };

  // 创建事件分发器
  const dispatcher = new Lark.EventDispatcher({
    encryptKey: account.encryptKey || undefined,
    verificationToken: account.verificationToken || undefined,
  }).register({
    'im.message.receive_v1': messageHandler,
    'card.action.trigger': cardHandler,
  });

  // 根据模式启动
  if (effectiveMode === 'webhook') {
    return startWebhook({ account, dispatcher, log, statusSink });
  }

  return startWebSocket({ account, dispatcher, log, statusSink });
}

// ============================================================
// WebSocket 模式
// ============================================================

function startWebSocket(opts: {
  account: FeishuProviderOptions['account'];
  dispatcher: Lark.EventDispatcher;
  log: FeishuProviderOptions['log'];
  statusSink?: FeishuProviderOptions['statusSink'];
}): { stop: () => void } {
  const { account, dispatcher, log, statusSink } = opts;
  const domain = account.domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu;

  const wsClient = new Lark.WSClient({
    appId: account.appId,
    appSecret: account.appSecret,
    domain,
    loggerLevel: Lark.LoggerLevel.info,
  });

  wsClient.start({ eventDispatcher: dispatcher });

  log.info('WebSocket client started');
  statusSink?.({ running: true, lastStartAt: Date.now(), mode: 'websocket' });

  return {
    stop: () => {
      log.info('Stopping WebSocket provider');
      statusSink?.({ running: false, lastStopAt: Date.now() });
    },
  };
}

// ============================================================
// Webhook 模式
// ============================================================

function startWebhook(opts: {
  account: FeishuProviderOptions['account'];
  dispatcher: Lark.EventDispatcher;
  log: FeishuProviderOptions['log'];
  statusSink?: FeishuProviderOptions['statusSink'];
}): { stop: () => void } {
  const { account, dispatcher, log, statusSink } = opts;
  const port = account.webhookPort || 3000;
  const webhookPath = account.webhookPath || '/feishu/events';

  const webhookHandler = Lark.adaptDefault(webhookPath, dispatcher, { autoChallenge: true });

  const server = http.createServer((req, res) => {
    if (req.url && !req.url.startsWith(webhookPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    webhookHandler(req, res).catch(err => {
      log.error(`Webhook handler error: ${(err as Error).message}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    });
  });

  server.listen(port, () => {
    log.info(`Webhook server listening on port ${port}, path ${webhookPath}`);
    statusSink?.({ running: true, lastStartAt: Date.now(), mode: 'webhook' });
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    log.error(`Webhook server error: ${err.message}`);
    statusSink?.({ running: false, lastError: err.message });
  });

  return {
    stop: () => {
      log.info('Stopping Webhook server');
      server.closeAllConnections();
      server.close();
      statusSink?.({ running: false, lastStopAt: Date.now() });
    },
  };
}