/**
 * Gateway - 网关层
 * 
 * 职责：协调各层，处理消息路由
 */

import type { Logger } from '../types';
import type { IAgent, AgentEvent } from '../agents';
import { AgentFactory } from '../agents';
import type { ToolRegistry, ToolContext, ITool } from '../tools';
import type { IChannel } from '../channels';
import {
  FeishuCardBuilder,
  ActionBuilder,
  createFeishuCardInteractionEnvelope,
} from '../channels/feishu';
import type {
  GatewayConfig,
  StandardMessage,
  InteractionEvent,
  InteractionResult,
} from './types';
import { SessionManager } from './session';

// ============================================================
// Gateway 实现
// ============================================================

export class Gateway {
  private config: GatewayConfig;
  private logger: Logger;
  private agent: IAgent;
  private toolRegistry: ToolRegistry;
  private sessionManager: SessionManager;
  private channels = new Map<string, IChannel>();
  private activeContext: {
    chatId: string;
    userId: string;
    sessionId: string;
    channelId: string;
  } | null = null;

  constructor(
    config: GatewayConfig,
    logger: Logger,
    toolRegistry: ToolRegistry
  ) {
    this.config = config;
    this.logger = logger;
    this.toolRegistry = toolRegistry;
    this.sessionManager = new SessionManager(config.dataDir || './data', logger);
    this.agent = AgentFactory.create('opencode', config.agent, logger);
  }

  // ============================================================
  // 初始化
  // ============================================================

  async init(): Promise<void> {
    // 初始化 Agent
    await this.agent.init();

    // 注册 Agent 事件处理器
    this.agent.onEvent(this.handleAgentEvent.bind(this));

    // 启动工具
    await this.toolRegistry.startAll();

    this.logger.info('[Gateway] Initialized');
  }

  // ============================================================
  // 注册
  // ============================================================

  /**
   * 注册渠道
   */
registerChannel(channel: IChannel): void {
    this.channels.set(channel.id, channel);

    // 注册消息处理器（Channel 已传递标准化消息）
    channel.onMessage(async (message: StandardMessage) => {
      await this.processMessage(message);
    });

    // 注册交互处理器
    if (channel.onInteraction) {
      channel.onInteraction(async (event: InteractionEvent) => {
        return this.processInteraction(event);
      });
    }

    this.logger.info(`[Gateway] Registered channel: ${channel.id}`);
  }

  /**
   * 注册工具
   */
  registerTool(tool: ITool): void {
    this.toolRegistry.register(tool);
  }

  // ============================================================
  // 消息处理
  // ============================================================

  async processMessage(message: StandardMessage): Promise<void> {
    const { chatId, userId, channelId } = message.source;
    const text = message.content.text || '';

    this.logger.info(`[Gateway] Message from ${chatId}: ${text.slice(0, 50)}...`);

    try {
      // 获取或创建 Session
      const session = this.sessionManager.getOrCreate(chatId);
      const agentSessionId = session.agentSessionId || await this.agent.createSession();

      // 关联 Agent Session
      if (!session.agentSessionId) {
        session.agentSessionId = agentSessionId;
        this.sessionManager.save();
      }

      // 设置活跃上下文
      this.activeContext = { chatId, userId, sessionId: agentSessionId, channelId };

      // 调用 Agent
      const response = await this.agent.sendPrompt(agentSessionId, text);

      // 发送响应
      if (response) {
        const channel = this.channels.get(channelId);
        if (channel) {
          await channel.sendText(chatId, response);
        }
      }
    } catch (error) {
      this.logger.error(`[Gateway] Message processing failed: ${(error as Error).message}`);

      const channel = this.channels.get(channelId);
      if (channel) {
        await channel.sendText(chatId, `❌ 处理出错: ${(error as Error).message}`);
      }
    }
  }

  // ============================================================
  // 交互处理
  // ============================================================

  async processInteraction(event: InteractionEvent): Promise<InteractionResult> {
    const { action, value } = event;
    this.logger.info(`[Gateway] Interaction: ${action}`);

    // ============================================================
    // 特殊处理 OpenCode Agent 相关交互
    // ============================================================
    if (action.startsWith('opencode.')) {
      return this.handleOpenCodeInteraction(action, value);
    }

    // ============================================================
    // 处理工具交互
    // ============================================================
    // 解析工具名和参数
    const [namespace, ...rest] = action.split('.');
    const toolName = rest.join('.');
    const toolArgs = ((value as Record<string, unknown>)?.args as Record<string, unknown>) || value;

    // 构建工具上下文
    const context = this.createToolContext(event);

    // 执行工具
    const result = await this.toolRegistry.execute(
      namespace === 'workflow' ? 'workflow' : namespace,
      { action: toolName, ...toolArgs },
      context
    );

    return {
      toast: result.success
        ? { type: 'success', content: '操作成功' }
        : { type: 'error', content: result.error || '操作失败' },
      card: result.approvalCard,
    };
  }

  /**
   * 处理 OpenCode Agent 相关交互 (permission/question)
   */
  private async handleOpenCodeInteraction(action: string, value: Record<string, unknown>): Promise<InteractionResult> {
    const args = (value as Record<string, unknown>)?.args as Record<string, unknown> || value;

    try {
      // 处理权限回复
      if (action === 'opencode.permission.reply') {
        const { permissionId, sessionId, response } = args;
        
        if (!permissionId || !sessionId || !response) {
          return { toast: { type: 'error', content: '缺少必要参数' } };
        }

        await this.agent.replyPermission(sessionId as string, permissionId as string, response as 'allow' | 'deny');
        
        this.logger.info(`[Gateway] Permission ${permissionId} ${response}ed via card`);
        return { toast: { type: 'success', content: response === 'allow' ? '✅ 已允许' : '❌ 已拒绝' } };
      }

      // 处理问题回复
      if (action === 'opencode.question.reply') {
        const { requestId, answerJson } = args;
        
        if (!requestId || !answerJson) {
          return { toast: { type: 'error', content: '缺少必要参数' } };
        }

        // 解析 answerJson
        let answer: unknown;
        try {
          answer = JSON.parse(answerJson as string);
        } catch {
          return { toast: { type: 'error', content: '答案格式错误' } };
        }

        await this.agent.replyQuestion(requestId as string, answer);
        
        this.logger.info(`[Gateway] Question ${requestId} replied via card`);
        return { toast: { type: 'success', content: '✅ 已回复' } };
      }

      // 未知的 opencode action
      this.logger.warn(`[Gateway] Unknown opencode action: ${action}`);
      return { toast: { type: 'error', content: `未知操作: ${action}` } };
    } catch (error) {
      this.logger.error(`[Gateway] OpenCode interaction error: ${(error as Error).message}`);
      return { toast: { type: 'error', content: `操作失败: ${(error as Error).message}` } };
    }
  }

  // ============================================================
  // Agent 事件处理
  // ============================================================

  private async handleAgentEvent(event: AgentEvent): Promise<void> {
    if (!this.activeContext) return;

    const channel = this.channels.get(this.activeContext.channelId);
    if (!channel) return;

    switch (event.type) {
      case 'permission': {
        await this.sendPermissionCard(channel, event.data);
        break;
      }
      case 'question': {
        await this.sendQuestionCard(channel, event.data);
        break;
      }
      case 'tool_status': {
        const statusMap: Record<string, string> = {
          running: `🔄 执行工具: ${event.data.name}`,
          completed: `✅ 完成: ${event.data.name}`,
          error: `❌ 失败: ${event.data.name}`,
        };
        await channel.sendText(this.activeContext.chatId, statusMap[event.data.status] || '');
        break;
      }
      case 'text_chunk': {
        if (event.data.isFinal) {
          await channel.sendText(this.activeContext.chatId, event.data.text);
        }
        break;
      }
    }
  }

  private async sendPermissionCard(channel: IChannel, permission: {
    id: string;
    sessionId: string;
    title: string;
    type: string;
  }): Promise<void> {
    const card = new FeishuCardBuilder()
      .setHeader('🔐 权限请求', 'orange')
      .addMarkdown(`**${permission.title}**\n\n类型: ${permission.type}`)
      .addActionRow(
        new ActionBuilder()
          .addPrimaryButton('✅ 允许', createFeishuCardInteractionEnvelope({
            kind: 'button',
            action: 'opencode.permission.reply',
            args: { permissionId: permission.id, sessionId: permission.sessionId, response: 'allow' },
          }))
          .addDangerButton('❌ 拒绝', createFeishuCardInteractionEnvelope({
            kind: 'button',
            action: 'opencode.permission.reply',
            args: { permissionId: permission.id, sessionId: permission.sessionId, response: 'deny' },
          }))
          .build()
      )
      .build();

    await channel.sendCard(this.activeContext!.chatId, card);
  }

  private async sendQuestionCard(channel: IChannel, question: {
    id: string;
    sessionId: string;
    questions: Array<{
      question: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
    }>;
  }): Promise<void> {
    const firstQuestion = question.questions[0];
    const actionBuilder = new ActionBuilder();

    for (const option of firstQuestion.options || []) {
      actionBuilder.addButton(option.label, 'default', createFeishuCardInteractionEnvelope({
        kind: 'button',
        action: 'opencode.question.reply',
        args: {
          requestId: question.id,
          sessionId: question.sessionId,
          answerJson: JSON.stringify([[option.label]]),
        },
      }));
    }

    const card = new FeishuCardBuilder()
      .setHeader('❓ ' + (firstQuestion.header || '问题'), 'blue')
      .addMarkdown(`**${firstQuestion.question}**`)
      .addActionRow(actionBuilder.build())
      .build();

    await channel.sendCard(this.activeContext!.chatId, card);
  }

  // ============================================================
  // 工具上下文
  // ============================================================

  private createToolContext(event: InteractionEvent): ToolContext {
    const channel = this.channels.get(event.channelId);

    return {
      chatId: event.chatId,
      userId: event.userId,
      messageId: event.messageId,
      sessionId: this.activeContext?.sessionId || '',
      sendText: async (text: string) => {
        await channel?.sendText(event.chatId, text);
      },
      sendCard: async (card: unknown) => {
        await channel?.sendCard(event.chatId, card);
      },
      logger: this.logger,
    };
  }

  // ============================================================
  // Getter
  // ============================================================

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  getActiveContext(): typeof this.activeContext {
    return this.activeContext;
  }

  // ============================================================
  // 关闭
  // ============================================================

  async shutdown(): Promise<void> {
    await this.toolRegistry.stopAll();
    await this.agent.shutdown();

    for (const channel of this.channels.values()) {
      channel.disconnect();
    }

    this.logger.info('[Gateway] Shutdown complete');
  }
}