/**
 * Gateway 层模块
 * 
 * 职责：
 * 1. 消息处理和路由
 * 2. OpenCode Session 管理
 * 3. MCP 工具调用
 */

// ============================================================
// 类型导出
// ============================================================

export type {
  GatewayConfig,
  MCPServerConfig,
  SessionInfo,
  ISessionManager,
  MCPToolDefinition,
  MCPToolCallRequest,
  MCPToolCallResult,
  IMCPClient,
  IMCPServer,
  ToolContext,
  IGateway,
  HookType,
  HookHandler,
  MessageHookContext,
  ToolCallHookContext,
  DetectedMessageType,
  DetectedMessage,
} from './types';

// ============================================================
// 组件导出
// ============================================================

export { SessionManager } from '../core/session';
export { MCPClient } from './mcp-client';
export { UnifiedMCPHTTPServer } from './unified-mcp-server';

// ============================================================
// Gateway 实现
// ============================================================

import type {
  GatewayConfig,
  IGateway,
  ISessionManager,
  IMCPClient,
  StandardMessage,
  InteractionEvent,
  InteractionResult,
  ToolContext,
  MCPToolCallRequest,
  Logger,
} from './types';
import type { ChannelPlugin, MediaPayload } from '../channels/types';
import { SessionManager as CoreSessionManager } from '../core/session';
import type { ActiveContext } from './context';
import { MCPClient } from './mcp-client';
import { FeishuCardBuilder, ActionBuilder } from '../api/feishu/card/card-builder';
import { createFeishuCardInteractionEnvelope } from '../api/feishu/card/card-interaction';
import { detectMessageType } from './utils/detect-message-type';

/** OpenCode SDK 类型 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenCodeClient = any;

export class Gateway implements IGateway {
  private config: GatewayConfig;
  private logger: Logger;
  private channels: Map<string, ChannelPlugin> = new Map();
  private sessionManager: CoreSessionManager;
  private mcpClient: MCPClient;
  private opencodeClient: OpenCodeClient | null = null;
  private activeContext: ActiveContext | null = null;

  constructor(config: GatewayConfig, logger: Logger, dataDir: string = './data') {
    this.config = config;
    this.logger = logger;
    
    const sessionStorePath = `${dataDir}/sessions/sessions.json`;
    this.sessionManager = new CoreSessionManager(sessionStorePath, logger);
    this.mcpClient = new MCPClient(logger);
  }

  // ============================================================
  // 上下文管理
  // ============================================================

  private setActiveContext(ctx: Omit<ActiveContext, 'updatedAt'>): void {
    this.activeContext = { ...ctx, updatedAt: Date.now() };
  }

  getActiveContext(): ActiveContext | null {
    return this.activeContext;
  }

  /**
   * 获取或创建 OpenCode Session ID
   * 
   * 流程：
   * 1. 获取本地 Session（用于持久化）
   * 2. 检查是否有关联的 OpenCode session ID
   * 3. 如果没有，创建 OpenCode session 并关联
   */
  private async getOrCreateOpenCodeSessionId(chatId: string): Promise<string> {
    this.logger.info(`[Gateway] getOrCreateOpenCodeSessionId called for chatId: ${chatId}`);
    
    const localSession = this.sessionManager.getOrCreateActive(chatId);
    this.logger.info(`[Gateway] Local session: id=${localSession.id}, agentSessionId=${localSession.agentSessionId || '(empty)'}`);
    
    // 如果已有关联的 OpenCode session ID，直接返回
    if (localSession.agentSessionId) {
      this.logger.info(`[Gateway] Reusing existing OpenCode session: ${localSession.agentSessionId}`);
      return localSession.agentSessionId;
    }

    // 创建 OpenCode session
    this.logger.info(`[Gateway] Creating new OpenCode session...`);
    const opencodeSessionId = await this.createOpenCodeSession();
    
    // 关联到本地 Session
    localSession.agentSessionId = opencodeSessionId;
    localSession.agentType = 'opencode';
    this.sessionManager.save();

    this.logger.info(`[Gateway] Linked OpenCode session: ${opencodeSessionId} -> local: ${localSession.id}`);
    
    return opencodeSessionId;
  }

  /**
   * 获取 OpenCode Session ID（仅查询，不创建）
   */
  private getOpenCodeSessionId(chatId: string): string | undefined {
    const localSessionId = this.sessionManager.activeSessionId(chatId);
    if (!localSessionId) return undefined;
    
    const session = this.sessionManager.findById(localSessionId);
    return session?.agentSessionId;
  }

  /** 获取当前活跃的 Channel */
  private getActiveChannel(): ChannelPlugin | undefined {
    const channelId = this.activeContext?.channelId;
    return channelId ? this.channels.get(channelId) : undefined;
  }

  /**
   * 创建 OpenCode Session
   */
  private async createOpenCodeSession(): Promise<string> {
    this.logger.info(`[Gateway] createOpenCodeSession called`);
    
    if (!this.opencodeClient) {
      this.logger.error(`[Gateway] OpenCode client is null!`);
      throw new Error('OpenCode client not initialized');
    }

    const body: Record<string, unknown> = { agent: 'build' };
    
    if (this.config.opencode.modelId && this.config.opencode.providerId) {
      body.model = {
        providerID: this.config.opencode.providerId,
        modelID: this.config.opencode.modelId,
      };
    }

    this.logger.info(`[Gateway] Calling opencodeClient.session.create with body: ${JSON.stringify(body)}`);
    
    const result = await this.opencodeClient.session.create({ body });
    const sessionId = result?.data?.id;

    this.logger.info(`[Gateway] OpenCode session.create result: sessionId=${sessionId || '(null)'}`);

    if (!sessionId) {
      throw new Error('Failed to create OpenCode session');
    }

    return sessionId;
  }

  // ============================================================
  // 初始化
  // ============================================================

  async init(): Promise<void> {
    await this.initOpenCode();
    await this.mcpClient.startAll();
    this.logger.info('[Gateway] Initialized');
  }

  private async initOpenCode(): Promise<void> {
    try {
      const sdk = await import('@opencode-ai/sdk');
      this.opencodeClient = sdk.createOpencodeClient({
        baseUrl: this.config.opencode.url,
      });
      this.logger.info('[Gateway] OpenCode SDK initialized');
    } catch (error) {
      this.logger.error(`[Gateway] OpenCode SDK init failed: ${(error as Error).message}`);
      throw error;
    }
  }

  // ============================================================
  // Channel 管理
  // ============================================================

  registerChannel(channel: ChannelPlugin): void {
    this.channels.set(channel.id, channel);
    this.logger.info(`[Gateway] Registered channel: ${channel.id}`);

    channel.onMessage(this.processMessage.bind(this));

    if (channel.onInteraction) {
      channel.onInteraction(this.processInteraction.bind(this));
    }
  }

  // ============================================================
  // 消息处理
  // ============================================================

  async processMessage(message: StandardMessage): Promise<void> {
    const { chatId, userId, channelId } = message.source;
    const text = message.content.text || '';

    this.logger.info(`[Gateway] Processing message from ${chatId}: ${text.slice(0, 50)}...`);

    try {
      // 获取或创建 OpenCode Session ID
      const sessionId = await this.getOrCreateOpenCodeSessionId(chatId);
      this.logger.info(`[Gateway] OpenCode Session ID: ${sessionId}`);

      // 设置活跃上下文（使用 OpenCode session ID）
      this.setActiveContext({ chatId, userId, sessionId, channelId });

      const response = await this.callOpenCode(sessionId, text);
      this.logger.info(`[Gateway] OpenCode response: ${response?.slice(0, 200) || '(null)'}`);

      const channel = this.channels.get(channelId);
      if (channel && response) {
        await this.sendResponse(channel, chatId, response);
      } else {
        this.logger.warn(`[Gateway] No response to send - channel: ${!!channel}, response: ${!!response}`);
      }
    } catch (error) {
      this.logger.error(`[Gateway] Message processing failed: ${(error as Error).message}`);
      
      const channel = this.channels.get(channelId);
      if (channel) {
        await channel.outbound.sendText(chatId, `❌ 处理出错: ${(error as Error).message}`);
      }
    }
  }

  private async sendResponse(channel: ChannelPlugin, chatId: string, response: string): Promise<void> {
    const detected = detectMessageType(response);
    this.logger.info(`[Gateway] Detected message type: ${detected.type}`);

    switch (detected.type) {
      case 'richText': {
        const images = detected.images || [];
        if (images.length > 0 && channel.outbound.sendRichText) {
          await channel.outbound.sendRichText(chatId, detected.text, images);
        } else {
          await channel.outbound.sendText(chatId, response);
        }
        break;
      }

      case 'media': {
        if (detected.mediaUrl && channel.outbound.sendMedia) {
          await channel.outbound.sendMedia(
            chatId,
            { url: detected.mediaUrl } as MediaPayload,
            detected.text || undefined
          );
        } else {
          await channel.outbound.sendText(chatId, response);
        }
        break;
      }

      default: {
        await channel.outbound.sendText(chatId, detected.text);
      }
    }
  }

  // ============================================================
  // OpenCode 调用
  // ============================================================

  /**
   * 执行 Prompt（公开方法，供外部调用）
   * 用于 Cron 任务等场景
   */
  async executePrompt(sessionId: string, prompt: string): Promise<string | null> {
    return this.callOpenCode(sessionId, prompt);
  }

  private buildRequestBody(prompt: string): Record<string, unknown> {
    const body: Record<string, unknown> = {
      parts: [{ type: 'text' as const, text: prompt }],
    };
    
    if (this.config.opencode.modelId && this.config.opencode.providerId) {
      body.model = {
        providerID: this.config.opencode.providerId,
        modelID: this.config.opencode.modelId,
      };
    }
    return body;
  }

  private async callOpenCode(sessionId: string, prompt: string): Promise<string | null> {
    if (!this.opencodeClient) {
      throw new Error('OpenCode client not initialized');
    }

    this.logger.info(`[OpenCode] Sending prompt to session ${sessionId}: ${prompt.slice(0, 100)}...`);

    const timeout = this.config.opencode.timeout || 600000;
    const progressConfig = this.config.opencode.progress || {};
    const body = this.buildRequestBody(prompt);

    try {
      if (progressConfig.enabled !== false) {
        return await this.callOpenCodeWithSSE(sessionId, body, timeout, progressConfig);
      }
    } catch (sseError) {
      this.logger.warn(`[OpenCode] SSE mode failed, falling back: ${(sseError as Error).message}`);
    }

    return this.callOpenCodeSync(sessionId, body);
  }

  private async callOpenCodeWithSSE(
    sessionId: string,
    body: Record<string, unknown>,
    timeout: number,
    progressConfig: { showTextOutput?: boolean; showToolStatus?: boolean }
  ): Promise<string | null> {
    this.logger.info('[OpenCode] Starting SSE event stream mode...');

    const eventStream = await this.opencodeClient.event.subscribe();
    if (!eventStream?.stream) {
      throw new Error('Event stream not available');
    }

    const promptPromise = this.opencodeClient.session.prompt({
      path: { id: sessionId },
      body,
    });

    const textParts: Record<number, string> = {};
    let completed = false;
    const startTime = Date.now();

    const streamIterator = eventStream.stream[Symbol.asyncIterator]();

    while (!completed && Date.now() - startTime < timeout) {
      let eventResult;
      try {
        eventResult = await Promise.race([
          streamIterator.next(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ]);
      } catch {
        continue;
      }

      if (eventResult.done) break;

      const event = eventResult.value;
      const eventType = (event as { type?: string }).type;
      const props = (event as { properties?: Record<string, unknown> }).properties || {};

      // 过滤非当前 session 的事件
      const eventSessionId = props.sessionID || (props.info as { sessionID?: string })?.sessionID;
      if (eventSessionId && eventSessionId !== sessionId) continue;

      switch (eventType) {
        case 'message.part.updated': {
          const part = props.part as Record<string, unknown> | undefined;
          if (!part) break;

          if (part.type === 'text' && part.text) {
            const partIndex = (part.index as number) ?? 0;
            const isFinal = part.ignored !== true;
            textParts[partIndex] = part.text as string;

            if (progressConfig.showTextOutput && isFinal) {
              await this.sendToActiveChat(part.text as string);
            }
          }

          if (part.type === 'tool' && progressConfig.showToolStatus) {
            await this.handleToolStatus(part);
          }
          break;
        }

        case 'session.idle':
          completed = true;
          break;

        case 'session.error': {
          const error = props.error as { message?: string } | undefined;
          throw new Error(error?.message || 'Session error');
        }

        case 'permission.updated':
          await this.handlePermissionEvent(props);
          break;

        case 'question.asked':
          await this.handleQuestionEvent(props);
          break;
      }
    }

    try {
      await Promise.race([promptPromise, new Promise((_, r) => setTimeout(() => r(new Error()), 3000))]);
    } catch { /* ignore */ }

    const response = Object.keys(textParts)
      .sort((a, b) => Number(a) - Number(b))
      .map(k => textParts[Number(k)])
      .join('\n\n');

    return response || null;
  }

  private async handleToolStatus(part: Record<string, unknown>): Promise<void> {
    const state = part.state as { status?: string } | undefined;
    const toolName = (part.tool || part.name || 'unknown') as string;
    const channel = this.getActiveChannel();
    const chatId = this.activeContext?.chatId;

    if (!channel || !chatId || !state) return;

    const statusMap: Record<string, string> = {
      running: `🔄 执行工具: ${toolName}`,
      completed: `✅ 完成: ${toolName}`,
      error: `❌ 失败: ${toolName}`,
    };

    if (statusMap[state.status || '']) {
      await channel.outbound.sendText(chatId, statusMap[state.status || '']);
    }
  }

  private async sendToActiveChat(text: string): Promise<void> {
    const channel = this.getActiveChannel();
    const chatId = this.activeContext?.chatId;
    if (channel && chatId) {
      await channel.outbound.sendText(chatId, text);
    }
  }

  private async callOpenCodeSync(sessionId: string, body: Record<string, unknown>): Promise<string | null> {
    this.logger.info('[OpenCode] Using sync mode...');

    const result = await this.opencodeClient.session.prompt({
      path: { id: sessionId },
      body,
    });

    const data = result?.data;
    if (data?.parts && Array.isArray(data.parts)) {
      const textParts = data.parts
        .filter((p: { type: string }) => p.type === 'text')
        .map((p: { text: string }) => p.text)
        .join('\n');
      return textParts || null;
    }

    return null;
  }

  // ============================================================
  // OpenCode 事件处理
  // ============================================================

  private async handlePermissionEvent(props: Record<string, unknown>): Promise<void> {
    this.logger.info('[OpenCode] Permission request received');
    
    const permission = props as {
      id?: string;
      sessionID?: string;
      title?: string;
      type?: string;
    };

    const channel = this.getActiveChannel();
    const chatId = this.activeContext?.chatId;

    if (!channel?.outbound.sendCard || !chatId || !permission.id) return;

    const card = new FeishuCardBuilder()
      .setHeader('🔐 权限请求', 'orange')
      .addMarkdown(`**${permission.title || '需要您的确认'}**\n\n类型: ${permission.type || '未知'}`)
      .addActionRow(
        new ActionBuilder()
          .addPrimaryButton('✅ 允许', createFeishuCardInteractionEnvelope({
            kind: 'button',
            action: 'opencode.permission.reply',
            args: { permissionId: permission.id, sessionId: permission.sessionID, response: 'allow' },
          }))
          .addDangerButton('❌ 拒绝', createFeishuCardInteractionEnvelope({
            kind: 'button',
            action: 'opencode.permission.reply',
            args: { permissionId: permission.id, sessionId: permission.sessionID, response: 'deny' },
          }))
          .build()
      )
      .build();

    await channel.outbound.sendCard(chatId, card);
  }

  private async handleQuestionEvent(props: Record<string, unknown>): Promise<void> {
    this.logger.info('[OpenCode] Question request received');
    
    const questionRequest = props as {
      id?: string;
      sessionID?: string;
      questions?: Array<{
        question?: string;
        header?: string;
        options?: Array<{ label: string; description?: string }>;
      }>;
    };

    const channel = this.getActiveChannel();
    const chatId = this.activeContext?.chatId;

    if (!channel?.outbound.sendCard || !chatId || !questionRequest.questions?.length || !questionRequest.id) return;

    const firstQuestion = questionRequest.questions[0];
    const actionBuilder = new ActionBuilder();

    for (const option of firstQuestion.options || []) {
      actionBuilder.addButton(option.label, 'default', createFeishuCardInteractionEnvelope({
        kind: 'button',
        action: 'opencode.question.reply',
        args: {
          requestId: questionRequest.id,
          sessionId: questionRequest.sessionID,
          answerJson: JSON.stringify([[option.label]]),
        },
      }));
    }

    actionBuilder.addDangerButton('跳过', createFeishuCardInteractionEnvelope({
      kind: 'button',
      action: 'opencode.question.reject',
      args: { requestId: questionRequest.id, sessionId: questionRequest.sessionID },
    }));

    const card = new FeishuCardBuilder()
      .setHeader('❓ ' + (firstQuestion.header || '问题'), 'blue')
      .addMarkdown(`**${firstQuestion.question || '请选择'}**`)
      .addActionRow(actionBuilder.build())
      .build();

    await channel.outbound.sendCard(chatId, card);
  }

  // ============================================================
  // 交互处理
  // ============================================================

  async processInteraction(event: InteractionEvent): Promise<InteractionResult> {
    const { action, value } = event;
    this.logger.info(`[Gateway] Processing interaction: ${action}`);

    const [namespace, ...rest] = action.split('.');
    const toolName = rest.join('.');
    const toolArgs = ((value as Record<string, unknown>)?.args as Record<string, unknown>) || value;

    // OpenCode 特殊处理
    if (action === 'opencode.permission.reply') return this.handlePermissionReply(toolArgs);
    if (action === 'opencode.question.reply') return this.handleQuestionReply(toolArgs);
    if (action === 'opencode.question.reject') return this.handleQuestionReject(toolArgs);

    // 构建 ToolContext
    const context = this.createToolContext(event);

    const result = await this.mcpClient.callTool(
      { server: namespace, tool: toolName, arguments: toolArgs },
      context
    );

    if (result.success && result.output && typeof result.output === 'string' && result.requiresApproval) {
      await context.sendText(`✅ ${result.output}`);
    }

    return {
      toast: result.success
        ? { type: 'success', content: '操作成功' }
        : { type: 'error', content: result.error || '操作失败' },
      card: result.approvalCard ? { type: 'raw', data: result.approvalCard } : undefined,
    };
  }

  private createToolContext(event: InteractionEvent): ToolContext {
    const channel = Array.from(this.channels.values())[0];

    return {
      chatId: event.chatId,
      userId: event.userId,
      messageId: event.messageId,
      sessionId: this.getOpenCodeSessionId(event.chatId) || '',
      sendText: async (text: string) => {
        await channel?.outbound.sendText(event.chatId, text);
      },
      sendRichText: async (text: string, images: string[]) => {
        await channel?.outbound.sendRichText?.(event.chatId, text, images);
      },
      sendFile: async (filePath: string) => {
        await channel?.outbound.sendFile?.(event.chatId, filePath);
      },
      sendCard: async (card: unknown) => {
        await channel?.outbound.sendCard?.(event.chatId, card);
      },
      sendMedia: async (url: string, text?: string) => {
        await channel?.outbound.sendMedia?.(event.chatId, { url } as MediaPayload, text);
      },
      logger: this.logger,
    };
  }

  // ============================================================
  // OpenCode 权限/问题回复
  // ============================================================

  private async handlePermissionReply(args: Record<string, unknown>): Promise<InteractionResult> {
    const { permissionId, sessionId, response } = args;

    if (!permissionId || !sessionId || !response) {
      return { toast: { type: 'error', content: '参数错误' } };
    }

    if (!this.opencodeClient) {
      return { toast: { type: 'error', content: 'OpenCode 客户端未初始化' } };
    }

    try {
      await this.opencodeClient.postSessionIdPermissionsPermissionId({
        path: { id: sessionId as string, permissionId: permissionId as string },
        body: { response: response as string },
      });

      return {
        toast: {
          type: response === 'allow' ? 'success' : 'info',
          content: response === 'allow' ? '✅ 已允许' : '❌ 已拒绝',
        },
      };
    } catch (error) {
      return { toast: { type: 'error', content: `操作失败: ${(error as Error).message}` } };
    }
  }

  private async handleQuestionReply(args: Record<string, unknown>): Promise<InteractionResult> {
    const { requestId, answerJson } = args;

    if (!requestId || !answerJson) {
      return { toast: { type: 'error', content: '参数错误' } };
    }

    try {
      const answers = JSON.parse(answerJson as string);
      const res = await fetch(
        `${this.config.opencode.url}/question/${requestId}/reply`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers }) }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { toast: { type: 'success', content: '✅ 已回复' } };
    } catch (error) {
      return { toast: { type: 'error', content: `操作失败: ${(error as Error).message}` } };
    }
  }

  private async handleQuestionReject(args: Record<string, unknown>): Promise<InteractionResult> {
    const { requestId } = args;

    if (!requestId) {
      return { toast: { type: 'error', content: '参数错误' } };
    }

    try {
      const res = await fetch(
        `${this.config.opencode.url}/question/${requestId}/reject`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { toast: { type: 'info', content: '⏭️ 已跳过' } };
    } catch (error) {
      return { toast: { type: 'error', content: `操作失败: ${(error as Error).message}` } };
    }
  }

  // ============================================================
  // Getter
  // ============================================================

  getMCPClient(): IMCPClient {
    return this.mcpClient;
  }

  getSessionManager(): ISessionManager {
    return {
      getOrCreate: async (chatId: string) => {
        return await this.getOrCreateOpenCodeSessionId(chatId);
      },
      getSessionId: (chatId: string) => this.getOpenCodeSessionId(chatId),
      getSessionInfo: (chatId: string) => {
        const localSessionId = this.sessionManager.activeSessionId(chatId);
        const session = localSessionId ? this.sessionManager.findById(localSessionId) : undefined;
        return session ? { id: session.agentSessionId || session.id, chatId, createdAt: session.createdAt, lastActiveAt: session.updatedAt } : undefined;
      },
      cleanupExpired: () => {},
    };
  }

  // ============================================================
  // 关闭
  // ============================================================

  async shutdown(): Promise<void> {
    await this.mcpClient.stopAll();
    this.logger.info('[Gateway] Shutdown complete');
  }
}

// ============================================================
// 工厂函数
// ============================================================

export function createGateway(config: GatewayConfig, logger: Logger, dataDir?: string): Gateway {
  return new Gateway(config, logger, dataDir);
}