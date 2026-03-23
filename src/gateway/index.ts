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
} from './types';
import type { ChannelPlugin } from '../channels/types';
import { SessionManager } from './session';
import { MCPClient } from './mcp-client';
import { FeishuCardBuilder, ActionBuilder } from '../api/feishu/card/card-builder';
import { createFeishuCardInteractionEnvelope } from '../api/feishu/card/card-interaction';

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

    const options: Record<string, unknown> = { agent: 'build' };
    if (this.config.opencode.modelId) {
      options.model_id = this.config.opencode.modelId;
    }
    if (this.config.opencode.providerId) {
      options.provider_id = this.config.opencode.providerId;
    }

    const result = await this.opencodeClient.session.create({ body: options });
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

      // 设置活跃上下文（供 MCP 工具使用）
      this.sessionManager.setActiveContext({ chatId, userId, sessionId, channelId });

      // 调用 OpenCode
      const response = await this.callOpenCode(sessionId, text);

      // 获取 Channel 发送响应
      const channel = this.channels.get(channelId);
      if (channel && response) {
        await channel.outbound.sendText(chatId, response);
      }
    } catch (error) {
      this.logger.error(`[Gateway] Message processing failed: ${(error as Error).message}`);
      
      const channel = this.channels.get(channelId);
      if (channel) {
        await channel.outbound.sendText(chatId, `❌ 处理出错: ${(error as Error).message}`);
      }
    }
  }

  private async callOpenCode(sessionId: string, prompt: string): Promise<string | null> {
    if (!this.opencodeClient) {
      throw new Error('OpenCode client not initialized');
    }

    const timeout = this.config.opencode.timeout || 600000;
    const progressConfig = this.config.opencode.progress || {};

    this.logger.info(`[OpenCode] Sending prompt to session ${sessionId}: ${prompt.slice(0, 100)}...`);

    // 使用 promptAsync + SSE 事件流，避免阻塞
    try {
      // 1. 启动 SSE 事件流监听
      const eventStream = this.opencodeClient.global.event();
      
      // 防御性检查
      if (!eventStream?.stream) {
        this.logger.error('[OpenCode] Event stream is not available, falling back to sync mode');
        // 降级：使用同步模式
        const result = await this.opencodeClient.session.prompt({
          path: { id: sessionId },
          body: {
            parts: [{ type: 'text' as const, text: prompt }],
          },
        });
        return result?.data?.output || result?.data?.text || null;
      }
      
      const streamIterator = eventStream.stream[Symbol.asyncIterator]();

      // 2. 发送异步 prompt（立即返回）
      await this.opencodeClient.session.promptAsync({
        path: { id: sessionId },
        body: {
          parts: [{ type: 'text' as const, text: prompt }],
        },
      });

      this.logger.info(`[OpenCode] Prompt sent async, waiting for events...`);

      // 3. 收集响应和状态
      const textParts: string[] = [];
      let completed = false;
      const startTime = Date.now();

      // 4. 监听事件流直到完成或超时
      while (!completed) {
        // 检查超时
        if (Date.now() - startTime > timeout) {
          throw new Error(`AI 响应超时 (${timeout / 1000}s)`);
        }

        // 等待下一个事件（带超时）
        const eventPromise = streamIterator.next();
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Event stream timeout')), 30000)
        );

        let eventResult;
        try {
          eventResult = await Promise.race([eventPromise, timeoutPromise]);
        } catch (e) {
          // 超时后继续等待
          continue;
        }

        if (eventResult.done) {
          this.logger.warn('[OpenCode] Event stream ended');
          break;
        }

        const event = eventResult.value;

        // 过滤当前 session 的事件
        const eventPayload = event as { type: string; properties?: Record<string, unknown> };
        const props = eventPayload.properties || {};
        const eventSessionId = props.sessionID || (props.info as { sessionID?: string })?.sessionID;

        if (eventSessionId && eventSessionId !== sessionId) {
          continue;
        }

        // 处理不同类型的事件
        switch (eventPayload.type) {
          case 'message.part.updated': {
            const part = props.part as Record<string, unknown>;
            if (!part) break;

            // 文本部分
            if (part.type === 'text' && !part.ignored && part.text) {
              textParts.push(part.text as string);

              // 如果配置了显示文本输出，推送到飞书
              if (progressConfig.enabled && progressConfig.showTextOutput) {
                const channel = this.channels.get(this.sessionManager.getActiveContext()?.channelId || '');
                if (channel) {
                  await channel.outbound.sendText(this.sessionManager.getActiveContext()?.chatId || '', part.text as string);
                }
              }
            }

            // 工具执行状态
            if (part.type === 'tool' && progressConfig.enabled && progressConfig.showToolStatus) {
              const state = part.state as { status: string; input?: Record<string, unknown> } | undefined;
              const toolName = part.tool || part.name || 'unknown';
              const channel = this.channels.get(this.sessionManager.getActiveContext()?.channelId || '');
              const chatId = this.sessionManager.getActiveContext()?.chatId || '';

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

          case 'session.idle': {
            // 会话空闲，任务完成
            this.logger.info('[OpenCode] Session idle, task completed');
            completed = true;
            break;
          }

          case 'session.error': {
            const error = props.error as { message?: string } | undefined;
            throw new Error(error?.message || 'Session error');
          }

          case 'permission.updated': {
            // 权限请求 - 推送飞书卡片让用户确认
            this.logger.info(`[OpenCode] Permission request received`);
            const permission = props as {
              id: string;
              sessionID: string;
              title: string;
              type: string;
              metadata?: Record<string, unknown>;
            };

            const channel = this.channels.get(this.sessionManager.getActiveContext()?.channelId || '');
            const chatId = this.sessionManager.getActiveContext()?.chatId || '';

            if (channel && chatId && channel.outbound.sendCard) {
              // 构建权限确认卡片
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
            break;
          }

          case 'question.asked': {
            // 问题请求 - 推送飞书卡片让用户选择
            this.logger.info(`[OpenCode] Question request received`);
            const questionRequest = props as {
              id: string;
              sessionID: string;
              questions: Array<{
                question: string;
                header: string;
                options: Array<{ label: string; description: string }>;
                multiple?: boolean;
              }>;
            };

            const channel = this.channels.get(this.sessionManager.getActiveContext()?.channelId || '');
            const chatId = this.sessionManager.getActiveContext()?.chatId || '';

            if (channel && chatId && channel.outbound.sendCard && questionRequest.questions?.length > 0) {
              const firstQuestion = questionRequest.questions[0];
              
              // 构建问题卡片
              const cardBuilder = new FeishuCardBuilder()
                .setHeader('❓ ' + (firstQuestion.header || '问题'), 'blue')
                .addMarkdown(`**${firstQuestion.question || '请选择'}**`);

              // 构建选项按钮
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

              // 添加拒绝按钮
              actionBuilder.addDangerButton('跳过', createFeishuCardInteractionEnvelope({
                kind: 'button',
                action: 'opencode.question.reject',
                args: {
                  requestId: questionRequest.id,
                  sessionId: questionRequest.sessionID,
                },
              }));

              cardBuilder.addActionRow(actionBuilder.build());
              const card = cardBuilder.build();

              await channel.outbound.sendCard(chatId, card);
              this.logger.info(`[OpenCode] Question card sent to ${chatId}`);
            }
            break;
          }
        }
      }

      // 5. 返回收集的文本
      const response = textParts.join('\n\n') || null;
      this.logger.info(`[OpenCode] Final response: ${response?.slice(0, 200) || '(empty)'}`);

      return response;

    } catch (error) {
      this.logger.error(`[OpenCode] Error: ${(error as Error).message}`);
      throw error;
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
      sendCard: async (card: unknown) => {
        const channel = Array.from(this.channels.values())[0];
        if (channel?.outbound.sendCard) {
          await channel.outbound.sendCard(event.chatId, card);
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