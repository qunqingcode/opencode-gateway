/**
 * Gateway 层模块
 * 
 * 职责：
 * 1. 消息处理和路由
 * 2. OpenCode Session 管理
 * 3. MCP 工具调用
 * 4. Hook 系统
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

export { SessionManager } from './session';
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
  IMCPServer,
  StandardMessage,
  InteractionEvent,
  InteractionResult,
  ToolContext,
  MCPToolCallRequest,
  Logger,
  DetectedMessage,
} from './types';
import type { ChannelPlugin, MediaPayload } from '../channels/types';
import { SessionManager } from './session';
import { MCPClient } from './mcp-client';
import { FeishuCardBuilder, ActionBuilder } from '../api/feishu/card/card-builder';
import { createFeishuCardInteractionEnvelope } from '../api/feishu/card/card-interaction';
import { detectMessageType } from './utils/detect-message-type';

/** OpenCode SDK 类型 - 使用 any 避免类型冲突 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenCodeClient = any;

export class Gateway implements IGateway {
  private config: GatewayConfig;
  private logger: Logger;
  private channels: Map<string, ChannelPlugin> = new Map();
  private sessionManager: SessionManager;
  private mcpClient: MCPClient;
  private opencodeClient: OpenCodeClient | null = null;

  constructor(config: GatewayConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.sessionManager = new SessionManager(logger, this.createOpenCodeSession.bind(this));
    this.mcpClient = new MCPClient(logger);
  }

  // ============================================================
  // 初始化
  // ============================================================

  async init(): Promise<void> {
    // 初始化 OpenCode SDK
    await this.initOpenCode();

    // 启动所有 MCP Servers
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

  private async createOpenCodeSession(chatId: string): Promise<string> {
    if (!this.opencodeClient) {
      throw new Error('OpenCode client not initialized');
    }

    // 按照官方文档格式
    const body: Record<string, unknown> = { agent: 'build' };
    
    // model 配置格式: { providerID, modelID }
    if (this.config.opencode.modelId && this.config.opencode.providerId) {
      body.model = {
        providerID: this.config.opencode.providerId,
        modelID: this.config.opencode.modelId,
      };
    }

    const result = await this.opencodeClient.session.create({ body });
    const sessionId = result?.data?.id;

    if (!sessionId) {
      throw new Error('Failed to create OpenCode session');
    }

    return sessionId;
  }

  // ============================================================
  // Channel 管理
  // ============================================================

  registerChannel(channel: ChannelPlugin): void {
    this.channels.set(channel.id, channel);
    this.logger.info(`[Gateway] Registered channel: ${channel.id}`);

    // 注册消息处理器
    channel.onMessage(this.processMessage.bind(this));

    // 注册交互处理器
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
      // 获取或创建 Session
      const sessionId = await this.sessionManager.getOrCreate(chatId);
      this.logger.info(`[Gateway] Session ID: ${sessionId}`);

      // 设置活跃上下文（供 MCP 工具使用）
      this.sessionManager.setActiveContext({ chatId, userId, sessionId, channelId });

      // 调用 OpenCode
      const response = await this.callOpenCode(sessionId, text);
      this.logger.info(`[Gateway] OpenCode response: ${response?.slice(0, 200) || '(null)'}`);

      // 获取 Channel 发送响应
      const channel = this.channels.get(channelId);
      this.logger.info(`[Gateway] Channel found: ${!!channel}, channelId: ${channelId}`);
      if (channel && response) {
        this.logger.info(`[Gateway] Sending response to ${chatId}`);
        // 根据响应内容自动检测消息类型并发送
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

  /**
   * 根据响应内容自动检测消息类型并发送
   * 
   * 设计原则：
   * - 只自动处理 HTTP URL（图片、视频、音频）
   * - 本地文件路径不自动发送，需要 AI 调用 message.send_file 工具
   */
  private async sendResponse(
    channel: ChannelPlugin,
    chatId: string,
    response: string
  ): Promise<void> {
    // 检测消息类型
    const detected = detectMessageType(response);
    this.logger.info(`[Gateway] Detected message type: ${detected.type}`);

    switch (detected.type) {
      case 'richText': {
        // 富文本：文本 + HTTP 图片 URL
        const images = detected.images || [];
        if (images.length > 0 && channel.outbound.sendRichText) {
          this.logger.info(`[Gateway] Sending richText with ${images.length} images`);
          await channel.outbound.sendRichText(chatId, detected.text, images);
        } else {
          // 降级为纯文本
          await channel.outbound.sendText(chatId, response);
        }
        break;
      }

      case 'media': {
        // 媒体（HTTP 视频/音频 URL）
        if (detected.mediaUrl && channel.outbound.sendMedia) {
          this.logger.info(`[Gateway] Sending media: ${detected.mediaUrl}`);
          await channel.outbound.sendMedia(
            chatId,
            { url: detected.mediaUrl } as MediaPayload,
            detected.text || undefined
          );
        } else {
          // 降级为纯文本
          await channel.outbound.sendText(chatId, response);
        }
        break;
      }

      case 'text':
      default: {
        // 纯文本
        await channel.outbound.sendText(chatId, detected.text);
        break;
      }
    }
  }

  private async callOpenCode(sessionId: string, prompt: string): Promise<string | null> {
    if (!this.opencodeClient) {
      throw new Error('OpenCode client not initialized');
    }

    this.logger.info(`[OpenCode] Sending prompt to session ${sessionId}: ${prompt.slice(0, 100)}...`);

    const timeout = this.config.opencode.timeout || 600000;
    const progressConfig = this.config.opencode.progress || {};

    // 构建请求 body，按照官方文档格式
    const body: Record<string, unknown> = {
      parts: [{ type: 'text' as const, text: prompt }],
    };
    
    // 添加 model 配置
    if (this.config.opencode.modelId && this.config.opencode.providerId) {
      body.model = {
        providerID: this.config.opencode.providerId,
        modelID: this.config.opencode.modelId,
      };
    }

    try {
      // 尝试使用 SSE 事件流模式（官方文档推荐）
      // 参考文档: https://opencode.ai/docs/zh-cn/sdk/#events
      if (progressConfig.enabled !== false) {
        return await this.callOpenCodeWithSSE(sessionId, body, timeout, progressConfig);
      }
    } catch (sseError) {
      this.logger.warn(`[OpenCode] SSE mode failed, falling back to sync mode: ${(sseError as Error).message}`);
    }

    // 降级：同步模式 - 直接使用 session.prompt
    return await this.callOpenCodeSync(sessionId, body);
  }

  /**
   * SSE 事件流模式（官方文档推荐）
   * 参考文档: https://opencode.ai/docs/zh-cn/sdk/#events
   */
  private async callOpenCodeWithSSE(
    sessionId: string,
    body: Record<string, unknown>,
    timeout: number,
    progressConfig: { showTextOutput?: boolean; showToolStatus?: boolean }
  ): Promise<string | null> {
    this.logger.info('[OpenCode] Starting SSE event stream mode...');

    // 1. 订阅事件流（按照官方文档）
    // const events = await client.event.subscribe()
    // for await (const event of events.stream) { ... }
    const eventStream = await this.opencodeClient.event.subscribe();
    
    if (!eventStream?.stream) {
      throw new Error('Event stream not available');
    }

    this.logger.info('[OpenCode] Event stream subscribed');

    // 2. 发送 prompt
    this.logger.info('[OpenCode] Sending prompt...');
    
    const promptPromise = this.opencodeClient.session.prompt({
      path: { id: sessionId },
      body,
    });

    // 3. 监听事件流
    const textParts: Record<number, string> = {};
    let completed = false;
    const startTime = Date.now();
    let eventCount = 0;

    this.logger.info('[OpenCode] Listening to event stream...');

    const streamIterator = eventStream.stream[Symbol.asyncIterator]();

    while (!completed) {
      // 检查超时
      if (Date.now() - startTime > timeout) {
        this.logger.warn('[OpenCode] SSE timeout, will use collected text');
        break;
      }

      // 等待下一个事件
      const eventPromise = streamIterator.next();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Event timeout')), 5000)
      );

      let eventResult;
      try {
        eventResult = await Promise.race([eventPromise, timeoutPromise]);
      } catch {
        // 超时继续等待
        continue;
      }

      if (eventResult.done) {
        this.logger.info('[OpenCode] Event stream ended');
        break;
      }

      const event = eventResult.value;
      eventCount++;

      // 事件格式: { type: string, properties: object }
      const eventType = (event as { type?: string }).type;
      const props = (event as { properties?: Record<string, unknown> }).properties || {};

      // 只记录关键事件
      if (['message.part.updated', 'session.idle', 'session.error', 'permission.updated', 'question.asked'].includes(eventType || '')) {
        this.logger.debug?.(`[OpenCode] Event ${eventCount}: type=${eventType}`);
      }

      // 过滤当前 session 的事件
      const eventSessionId = props.sessionID || (props.info as { sessionID?: string })?.sessionID;
      if (eventSessionId && eventSessionId !== sessionId) {
        continue;
      }

      // 处理不同类型的事件
      switch (eventType) {
        // 文本部分更新 - 包含完整文本
        case 'message.part.updated': {
          const part = props.part as Record<string, unknown> | undefined;
          if (!part) break;

          // 文本部分
          if (part.type === 'text' && part.text) {
            const partIndex = (part.index as number) ?? 0;
            const isFinal = part.ignored !== true; // ignored=true 表示这是最终响应
            textParts[partIndex] = part.text as string;
            
            // 只在最终更新时记录
            if (isFinal) {
              this.logger.info(`[OpenCode] Text part ${partIndex}: ${(part.text as string).slice(0, 100)}...`);
            }

            // 如果配置了显示文本输出，推送到飞书（仅最终版本）
            if (progressConfig.showTextOutput && isFinal) {
              const chatId = this.sessionManager.getActiveContext()?.chatId || '';
              const channel = this.channels.get(this.sessionManager.getActiveContext()?.channelId || '');
              if (channel && chatId) {
                await channel.outbound.sendText(chatId, part.text as string);
              }
            }
          }

          // 工具执行状态
          if (part.type === 'tool' && progressConfig.showToolStatus) {
            const state = part.state as { status?: string } | undefined;
            const toolName = (part.tool || part.name || 'unknown') as string;
            const chatId = this.sessionManager.getActiveContext()?.chatId || '';
            const channel = this.channels.get(this.sessionManager.getActiveContext()?.channelId || '');

            if (channel && chatId && state) {
              if (state.status === 'running') {
                await channel.outbound.sendText(chatId, `🔄 执行工具: ${toolName}`);
              } else if (state.status === 'completed') {
                await channel.outbound.sendText(chatId, `✅ 完成: ${toolName}`);
              } else if (state.status === 'error') {
                await channel.outbound.sendText(chatId, `❌ 失败: ${toolName}`);
              }
            }
          }
          break;
        }

        // 会话空闲 - 任务完成
        case 'session.idle': {
          this.logger.info('[OpenCode] Session idle, task completed');
          completed = true;
          break;
        }

        // 会话错误
        case 'session.error': {
          const error = props.error as { message?: string } | undefined;
          throw new Error(error?.message || 'Session error');
        }

        // 权限请求
        case 'permission.updated': {
          await this.handlePermissionEvent(props);
          break;
        }

        // 问题请求
        case 'question.asked': {
          await this.handleQuestionEvent(props);
          break;
        }
      }
    }

    // 4. 等待 prompt 完成（确保没有遗漏）
    try {
      await Promise.race([
        promptPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Prompt timeout')), 3000))
      ]);
    } catch {
      // 忽略，已经通过事件流获取了响应
    }

    // 5. 返回收集的文本
    const responseParts = Object.keys(textParts)
      .sort((a, b) => Number(a) - Number(b))
      .map(k => textParts[Number(k)]);
    
    const response = responseParts.join('\n\n') || null;
    this.logger.info(`[OpenCode] SSE mode completed: events=${eventCount}, textParts=${responseParts.length}`);

    return response;
  }

  /**
   * 同步模式 - 直接使用 session.prompt
   */
  private async callOpenCodeSync(
    sessionId: string,
    body: Record<string, unknown>
  ): Promise<string | null> {
    this.logger.info('[OpenCode] Using sync mode...');

    const result = await this.opencodeClient.session.prompt({
      path: { id: sessionId },
      body,
    });

    this.logger.info('[OpenCode] Prompt completed, parsing response...');

    // 按照官方文档，响应结构是 { info, parts }
    const data = result?.data;
    
    if (data?.parts && Array.isArray(data.parts)) {
      const textParts = data.parts
        .filter((p: { type: string }) => p.type === 'text')
        .map((p: { text: string }) => p.text)
        .join('\n');
      if (textParts) {
        this.logger.info(`[OpenCode] Response: ${textParts.slice(0, 200)}...`);
        return textParts;
      }
    }

    this.logger.warn('[OpenCode] No text response found');
    return null;
  }

  /**
   * 处理权限事件
   */
  private async handlePermissionEvent(props: Record<string, unknown>): Promise<void> {
    this.logger.info('[OpenCode] Permission request received');
    
    const permission = props as {
      id?: string;
      sessionID?: string;
      title?: string;
      type?: string;
    };

    const chatId = this.sessionManager.getActiveContext()?.chatId || '';
    const channel = this.channels.get(this.sessionManager.getActiveContext()?.channelId || '');

    if (channel && chatId && channel.outbound.sendCard && permission.id) {
      const card = new FeishuCardBuilder()
        .setHeader('🔐 权限请求', 'orange')
        .addMarkdown(`**${permission.title || '需要您的确认'}**\n\n类型: ${permission.type || '未知'}`)
        .addActionRow(
          new ActionBuilder()
            .addPrimaryButton('✅ 允许', createFeishuCardInteractionEnvelope({
              kind: 'button',
              action: 'opencode.permission.reply',
              args: {
                permissionId: permission.id,
                sessionId: permission.sessionID,
                response: 'allow',
              },
            }))
            .addDangerButton('❌ 拒绝', createFeishuCardInteractionEnvelope({
              kind: 'button',
              action: 'opencode.permission.reply',
              args: {
                permissionId: permission.id,
                sessionId: permission.sessionID,
                response: 'deny',
              },
            }))
            .build()
        )
        .build();

      await channel.outbound.sendCard(chatId, card);
      this.logger.info(`[OpenCode] Permission card sent to ${chatId}`);
    }
  }

  /**
   * 处理问题事件
   */
  private async handleQuestionEvent(props: Record<string, unknown>): Promise<void> {
    this.logger.info('[OpenCode] Question request received');
    
    const questionRequest = props as {
      id?: string;
      sessionID?: string;
      questions?: Array<{
        question?: string;
        header?: string;
        options?: Array<{ label: string; description?: string }>;
        multiple?: boolean;
      }>;
    };

    const chatId = this.sessionManager.getActiveContext()?.chatId || '';
    const channel = this.channels.get(this.sessionManager.getActiveContext()?.channelId || '');

    if (channel && chatId && channel.outbound.sendCard && questionRequest.questions?.length && questionRequest.id) {
      const firstQuestion = questionRequest.questions[0];
      
      const cardBuilder = new FeishuCardBuilder()
        .setHeader('❓ ' + (firstQuestion.header || '问题'), 'blue')
        .addMarkdown(`**${firstQuestion.question || '请选择'}**`);

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
        args: {
          requestId: questionRequest.id,
          sessionId: questionRequest.sessionID,
        },
      }));

      cardBuilder.addActionRow(actionBuilder.build());
      
      await channel.outbound.sendCard(chatId, cardBuilder.build());
      this.logger.info(`[OpenCode] Question card sent to ${chatId}`);
    }
  }

  // ============================================================
  // 交互处理
  // ============================================================

  async processInteraction(event: InteractionEvent): Promise<InteractionResult> {
    const { action, value } = event;
    this.logger.info(`[Gateway] Processing interaction: ${action}`);
    this.logger.info(`[Gateway] Interaction value: ${JSON.stringify(value || {}).slice(0, 200)}`);

    // 解析 action 格式: server.tool 或 namespace.action
    const [namespace, ...rest] = action.split('.');
    const toolName = rest.join('.');

    this.logger.info(`[Gateway] Calling tool: ${namespace}.${toolName}`);

    // 从信封中提取真正的参数
    // value 结构: { version: 'ocf1', kind: 'button', action: 'action', args: {实际参数}, context: {上下文} }
    const actionValue = value as Record<string, unknown>;
    const toolArgs = (actionValue?.args as Record<string, unknown>) || value;

    // 特殊处理：OpenCode 权限回复
    if (action === 'opencode.permission.reply') {
      return this.handlePermissionReply(toolArgs);
    }

    // 特殊处理：OpenCode 问题回复
    if (action === 'opencode.question.reply') {
      return this.handleQuestionReply(toolArgs);
    }

    // 特殊处理：OpenCode 问题拒绝
    if (action === 'opencode.question.reject') {
      return this.handleQuestionReject(toolArgs);
    }

    // 构建工具上下文
    const context: ToolContext = {
      chatId: event.chatId,
      userId: event.userId,
      messageId: event.messageId,
      sessionId: this.sessionManager.getSessionId(event.chatId) || '',
      sendText: async (text: string) => {
        const channel = Array.from(this.channels.values())[0];
        if (channel) {
          await channel.outbound.sendText(event.chatId, text);
        }
      },
      sendRichText: async (text: string, images: string[]) => {
        const channel = Array.from(this.channels.values())[0];
        if (channel?.outbound.sendRichText) {
          await channel.outbound.sendRichText(event.chatId, text, images);
        }
      },
      sendFile: async (filePath: string) => {
        const channel = Array.from(this.channels.values())[0];
        if (channel?.outbound.sendFile) {
          await channel.outbound.sendFile(event.chatId, filePath);
        }
      },
      sendCard: async (card: unknown) => {
        const channel = Array.from(this.channels.values())[0];
        if (channel?.outbound.sendCard) {
          await channel.outbound.sendCard(event.chatId, card);
        }
      },
      sendMedia: async (url: string, text?: string) => {
        const channel = Array.from(this.channels.values())[0];
        if (channel?.outbound.sendMedia) {
          await channel.outbound.sendMedia(event.chatId, { url } as MediaPayload, text);
        }
      },
      logger: this.logger,
    };

    // 调用 MCP 工具
    const request: MCPToolCallRequest = {
      server: namespace,
      tool: toolName,
      arguments: toolArgs,
    };

    const result = await this.mcpClient.callTool(request, context);

    this.logger.info(`[Gateway] Tool result: success=${result.success}, error=${result.error || 'none'}`);

    // 如果工具执行成功且输出了文本消息，发送给用户
    if (result.success && result.output && typeof result.output === 'string') {
      // 注意：cancel 等工具会自己发送消息，这里不再重复发送
      // 只有当 requiresApproval 为 true 时才在这里发送（如 create_mr_confirm）
      if (result.requiresApproval && result.output !== '已发送审批卡片') {
        await context.sendText(`✅ ${result.output}`);
      }
    }

    // 构建卡片更新响应
    // 飞书要求格式: { type: "raw", data: { /* 卡片JSON */ } }
    let cardResponse: { type: 'raw'; data: unknown } | undefined;
    if (result.approvalCard) {
      cardResponse = {
        type: 'raw',
        data: result.approvalCard,
      };
      this.logger.info(`[Gateway] Returning approvalCard for update: ${JSON.stringify(cardResponse).slice(0, 500)}`);
    }

    const interactionResult = {
      toast: result.success
        ? { type: 'success' as const, content: '操作成功' }
        : { type: 'error' as const, content: result.error || '操作失败' },
      // 飞书卡片更新：包装成 { type: "raw", data: {...} } 格式
      card: cardResponse,
    };
    
    this.logger.info(`[Gateway] Interaction result: ${JSON.stringify(interactionResult).slice(0, 500)}`);
    
    return interactionResult;
  }

  // ============================================================
  // OpenCode 权限处理
  // ============================================================

  /**
   * 处理 OpenCode 权限回复
   * 用户在飞书卡片上点击"允许"或"拒绝"后调用
   */
  private async handlePermissionReply(args: Record<string, unknown>): Promise<InteractionResult> {
    const { permissionId, sessionId, response } = args;

    this.logger.info(`[Gateway] Permission reply: permissionId=${permissionId}, response=${response}`);

    if (!permissionId || !sessionId || !response) {
      return {
        toast: { type: 'error', content: '参数错误' },
      };
    }

    if (!this.opencodeClient) {
      return {
        toast: { type: 'error', content: 'OpenCode 客户端未初始化' },
      };
    }

    try {
      // 调用 OpenCode API 回复权限请求
      await this.opencodeClient.postSessionIdPermissionsPermissionId({
        path: {
          id: sessionId as string,
          permissionId: permissionId as string,
        },
        body: {
          response: response as string,
        },
      });

      this.logger.info(`[Gateway] Permission reply sent: ${response}`);

      return {
        toast: {
          type: response === 'allow' ? 'success' : 'info',
          content: response === 'allow' ? '✅ 已允许' : '❌ 已拒绝',
        },
      };
    } catch (error) {
      this.logger.error(`[Gateway] Permission reply failed: ${(error as Error).message}`);
      return {
        toast: { type: 'error', content: `操作失败: ${(error as Error).message}` },
      };
    }
  }

  /**
   * 处理 OpenCode 问题回复
   * 用户在飞书卡片上选择选项后调用
   */
  private async handleQuestionReply(args: Record<string, unknown>): Promise<InteractionResult> {
    const { requestId, sessionId, answerJson } = args;

    this.logger.info(`[Gateway] Question reply: requestId=${requestId}, answerJson=${answerJson}`);

    if (!requestId || !sessionId || !answerJson) {
      return {
        toast: { type: 'error', content: '参数错误' },
      };
    }

    if (!this.opencodeClient) {
      return {
        toast: { type: 'error', content: 'OpenCode 客户端未初始化' },
      };
    }

    try {
      // 解析答案
      const answers = JSON.parse(answerJson as string);

      // 调用 OpenCode API 回复问题
      const response = await fetch(
        `${this.config.opencode.url}/question/${requestId}/reply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      this.logger.info(`[Gateway] Question reply sent`);

      return {
        toast: { type: 'success', content: '✅ 已回复' },
      };
    } catch (error) {
      this.logger.error(`[Gateway] Question reply failed: ${(error as Error).message}`);
      return {
        toast: { type: 'error', content: `操作失败: ${(error as Error).message}` },
      };
    }
  }

  /**
   * 处理 OpenCode 问题拒绝
   * 用户在飞书卡片上点击"跳过"后调用
   */
  private async handleQuestionReject(args: Record<string, unknown>): Promise<InteractionResult> {
    const { requestId, sessionId } = args;

    this.logger.info(`[Gateway] Question reject: requestId=${requestId}`);

    if (!requestId) {
      return {
        toast: { type: 'error', content: '参数错误' },
      };
    }

    if (!this.opencodeClient) {
      return {
        toast: { type: 'error', content: 'OpenCode 客户端未初始化' },
      };
    }

    try {
      const response = await fetch(
        `${this.config.opencode.url}/question/${requestId}/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      this.logger.info(`[Gateway] Question reject sent`);

      return {
        toast: { type: 'info', content: '⏭️ 已跳过' },
      };
    } catch (error) {
      this.logger.error(`[Gateway] Question reject failed: ${(error as Error).message}`);
      return {
        toast: { type: 'error', content: `操作失败: ${(error as Error).message}` },
      };
    }
  }

  // ============================================================
  // Getter
  // ============================================================

  getMCPClient(): IMCPClient {
    return this.mcpClient;
  }

  getSessionManager(): ISessionManager {
    return this.sessionManager;
  }
  
  /**
   * 获取当前活跃上下文
   * 供 MCP 工具执行时使用
   */
  getActiveContext() {
    return this.sessionManager.getActiveContext();
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

export function createGateway(config: GatewayConfig, logger: Logger): Gateway {
  return new Gateway(config, logger);
}