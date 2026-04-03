/**
 * Gateway - 网关层
 * 
 * 职责：协调各层，处理消息路由
 */

import type { Logger } from '../types';
import type { IAgent, AgentEvent } from '../agents';
import { AgentFactory } from '../agents';
import type { ToolRegistry, ToolContext, ITool } from '../tools';
import type { CronStore } from '../tools/cron';
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
import { CronScheduler } from './cron-scheduler';
import type { FlowManager } from '../flow';

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
  private cronScheduler?: CronScheduler;
  private flowManager?: FlowManager;
  private activeContext: {
    chatId: string;
    userId: string;
    sessionId: string;
    channelId: string;
  } | null = null;

  constructor(
    config: GatewayConfig,
    logger: Logger,
    toolRegistry: ToolRegistry,
    cronStore?: CronStore
  ) {
    this.config = config;
    this.logger = logger;
    this.toolRegistry = toolRegistry;
    this.sessionManager = new SessionManager(config.dataDir || './data', logger);
    this.agent = AgentFactory.create('opencode', config.agent, logger);

    // 让 ToolRegistry 能获取当前活跃上下文
    toolRegistry.getContext = () => this.createToolContext();

    // 如果提供了 cronStore，立即创建 scheduler（init 时启动）
    if (cronStore) {
      this.cronScheduler = new CronScheduler(
        cronStore,
        this.executeCronJob.bind(this),
        this.logger
      );
    }
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

    // 启动 Cron 调度器
    this.cronScheduler?.start();

    this.logger.info('[Gateway] Initialized');
  }

  /**
   * 获取 Agent 实例
   */
  getAgent(): IAgent {
    return this.agent;
  }

  /**
   * 设置 FlowManager
   */
  setFlowManager(flowManager: FlowManager): void {
    this.flowManager = flowManager;
  }

  /**
   * 获取 FlowManager
   */
  getFlowManager(): FlowManager | undefined {
    return this.flowManager;
  }

  // ============================================================
  // 注册
  // ============================================================

  /**
   * 注册渠道
   */
  registerChannel(channel: IChannel): void {
    this.channels.set(channel.id, channel);

    // 注册消息处理器（包裹 try-catch 防止 unhandled rejection）
    channel.onMessage(async (message: StandardMessage) => {
      try {
        await this.processMessage(message);
      } catch (error) {
        this.logger.error(`[Gateway] Unhandled error in message handler: ${(error as Error).message}`);
        // 不要让错误传播出去，已经在上层处理了
      }
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
    let text = message.content.text || '';

    this.logger.info(`[Gateway] Message from ${chatId}: ${text.slice(0, 50)}...`);

    try {
      // 处理特殊命令
      if (text === '/new' || text === '/reset') {
        const session = this.sessionManager.getOrCreate(chatId);
        const oldSessionId = session.agentSessionId;
        
        // 创建新 session
        const newSessionId = await this.agent.createSession();
        session.agentSessionId = newSessionId;
        this.sessionManager.save();
        
        const channel = this.channels.get(channelId);
        if (channel) {
          await channel.sendText(chatId, `✅ 已开启新会话。\n\n_旧会话: ${oldSessionId || '无'}_\n_新会话: ${newSessionId}_`);
        }
        return;
      }

      // 显示当前 session 信息
      if (text === '/session' || text === '/info') {
        const session = this.sessionManager.getOrCreate(chatId);
        const channel = this.channels.get(channelId);
        
        if (!channel) return;
        
        if (session.agentSessionId && this.agent.getSessionTokenUsage) {
          const usage = await this.agent.getSessionTokenUsage(session.agentSessionId);
          await channel.sendText(chatId, `📊 **当前会话信息**\n\n- Session ID: ${session.agentSessionId}\n- Token 使用: ${usage?.total?.toLocaleString() || '未知'} / 200,000\n- 使用率: ${usage ? ((usage.total / 200000) * 100).toFixed(1) : '?'}%`);
        } else {
          await channel.sendText(chatId, `📊 **当前会话信息**\n\n- Session ID: ${session.agentSessionId || '未创建'}`);
        }
        return;
      }

      // 获取或创建 Session
      const session = this.sessionManager.getOrCreate(chatId);
      let agentSessionId = session.agentSessionId;

      // 检查 token 使用量，如果接近限制则自动创建新 session
      const MAX_TOKENS = 150000; // 200K 模型，预留 50K 余量
      
      if (agentSessionId && this.agent.getSessionTokenUsage) {
        const usage = await this.agent.getSessionTokenUsage(agentSessionId);
        
        if (usage && usage.total >= MAX_TOKENS) {
          this.logger.info(`[Gateway] Session ${agentSessionId} reached token limit (${usage.total}), creating new session`);
          
          // 创建新 session
          agentSessionId = await this.agent.createSession();
          session.agentSessionId = agentSessionId;
          this.sessionManager.save();
          
          // 通知用户
          const channel = this.channels.get(channelId);
          if (channel) {
            await channel.sendText(chatId, '⚠️ 上下文长度已接近限制，已自动开启新会话。');
          }
        }
      }

      // 如果没有 agentSessionId，创建一个新的
      if (!agentSessionId) {
        agentSessionId = await this.agent.createSession();
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
      const errorMsg = (error as Error).message;
      this.logger.error(`[Gateway] Message processing failed: ${errorMsg}`);

      // 尝试发送错误消息给用户（单独包裹，防止二次失败导致网关挂掉）
      try {
        const channel = this.channels.get(channelId);
        if (channel) {
          await channel.sendText(chatId, `❌ 处理出错: ${errorMsg}`);
        }
      } catch (sendError) {
        this.logger.error(`[Gateway] Failed to send error message: ${(sendError as Error).message}`);
        // 不再抛出错误，网关继续运行
      }
    }
  }

  // ============================================================
  // 交互处理
  // ============================================================

  async processInteraction(event: InteractionEvent): Promise<InteractionResult> {
    const { action, value } = event;
    this.logger.info(`[Gateway] Interaction: ${action}`);

    // 处理审批交互
    if (action === 'approval.approve' || action === 'approval.reject') {
      return this.handleApprovalInteraction(action, value);
    }

    // 处理 OpenCode Agent 相关交互
    if (action.startsWith('opencode.')) {
      return this.handleOpenCodeInteraction(action, value);
    }

    // 处理工具交互
    const toolName = action;
    const toolArgs = ((value as Record<string, unknown>)?.args as Record<string, unknown>) || value;

    // 卡片交互是异步的，需要从 event 获取上下文，而不是 activeContext
    const context = this.createToolContext(event);

    const result = await this.toolRegistry.execute(toolName, toolArgs, context);

    this.logger.info(`[Gateway] Tool execution result card: ${JSON.stringify(result.card, null, 2)}`);

    return {
      toast: result.success
        ? { type: 'success', content: '操作成功' }
        : { type: 'error', content: result.error || '操作失败' },
      card:{type:'raw',data:result.card} 
    };
  }

  /**
   * 处理审批交互
   */
  private async handleApprovalInteraction(action: string, value: Record<string, unknown>): Promise<InteractionResult> {
    const args = (value as Record<string, unknown>)?.args as Record<string, unknown> || value;
    const approvalId = args.approvalId as string;

    if (!approvalId) {
      return { toast: { type: 'error', content: '缺少审批 ID' } };
    }

    // 查找对应的 FlowEngine 暂停执行
    const flowManager = this.getFlowManager();
    if (!flowManager) {
      return { toast: { type: 'error', content: 'Flow 引擎未初始化' } };
    }

    const pausedExecution = flowManager.engine.findPausedExecutionByApprovalId(approvalId);

    if (!pausedExecution) {
      return { toast: { type: 'error', content: '审批请求不存在或已过期' } };
    }

    const approved = action === 'approval.approve';

    try {
      // 恢复 Flow 执行
      const result = await flowManager.engine.resume(pausedExecution.executionId, approved);

      this.logger.info(`[Gateway] Approval ${approvalId} ${approved ? 'approved' : 'rejected'}`);

      return {
        toast: approved
          ? { type: 'success', content: '✅ 已确认' }
          : { type: 'info', content: '已取消' },
        card: result.card ? { type: 'raw', data: result.card } : undefined,
      };
    } catch (error) {
      this.logger.error(`[Gateway] Approval handling error: ${(error as Error).message}`);
      return { toast: { type: 'error', content: `操作失败: ${(error as Error).message}` } };
    }
  }

  /**
   * 处理 OpenCode Agent 相关交互
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
    if (!this.activeContext) {
      this.logger.warn('[Gateway] Agent event received but no active context');
      return;
    }

    const channel = this.channels.get(this.activeContext.channelId);
    if (!channel) {
      this.logger.warn(`[Gateway] Channel not found: ${this.activeContext.channelId}`);
      return;
    }

    try {
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
    } catch (error) {
      this.logger.error(`[Gateway] Failed to handle agent event (${event.type}): ${(error as Error).message}`);
      // 发送错误提示给用户
      try {
        await channel.sendText(this.activeContext.chatId, `❌ 处理事件失败: ${(error as Error).message}`);
      } catch {
        // 忽略发送错误
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
    // 防御性检查：确保有有效的问题
    if (!question.questions || question.questions.length === 0) {
      this.logger.error('[Gateway] Question event has no questions');
      await channel.sendText(this.activeContext!.chatId, '❌ 收到空的问题请求');
      return;
    }

    const firstQuestion = question.questions[0];

    // 检查是否有选项
    if (!firstQuestion.options || firstQuestion.options.length === 0) {
      this.logger.error('[Gateway] Question has no options');
      await channel.sendText(
        this.activeContext!.chatId,
        `❓ **${firstQuestion.header || '问题'}**\n${firstQuestion.question}\n\n_此问题没有提供选项_`
      );
      return;
    }

    const actionBuilder = new ActionBuilder();

    for (const option of firstQuestion.options) {
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
  // Cron 任务执行
  // ============================================================

  /**
   * 执行 Cron 任务
   * 
   * 由 CronScheduler 调用
   */
  private async executeCronJob(job: { id: string; chatId: string; prompt: string }): Promise<void> {
    this.logger.info(`[Gateway] Executing cron job: ${job.id} for chat ${job.chatId}`);

    try {
      // 获取或创建 Session
      const session = this.sessionManager.getOrCreate(job.chatId);
      const agentSessionId = session.agentSessionId || await this.agent.createSession();

      // 关联 Agent Session
      if (!session.agentSessionId) {
        session.agentSessionId = agentSessionId;
        this.sessionManager.save();
      }

      // 设置活跃上下文（用于发送响应）
      this.activeContext = {
        chatId: job.chatId,
        userId: 'cron-system',
        sessionId: agentSessionId,
        channelId: 'feishu',
      };

      // 调用 Agent
      const response = await this.agent.sendPrompt(agentSessionId, job.prompt);

      // 发送响应到飞书
      if (response) {
        const channel = this.channels.get('feishu');
        if (channel) {
          await channel.sendText(job.chatId, `⏰ [定时任务] ${response}`);
        }
      }
    } catch (error) {
      this.logger.error(`[Gateway] Cron job execution failed: ${(error as Error).message}`);
      throw error; // 让 scheduler 记录错误
    }
  }

  // ============================================================
  // 工具上下文
  // ============================================================

  /**
   * 创建工具上下文
   * 
   * @param event - 卡片交互事件（异步场景，从 event 获取上下文）
   *                不传则从 activeContext 获取（同步场景）
   */
  private createToolContext(event?: InteractionEvent): ToolContext | undefined {
    // 异步场景：从 event 获取
    if (event) {
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

    // 同步场景：从 activeContext 获取
    if (!this.activeContext) return undefined;

    const channel = this.channels.get(this.activeContext.channelId);
    return {
      chatId: this.activeContext.chatId,
      userId: this.activeContext.userId,
      sessionId: this.activeContext.sessionId,
      sendText: async (text: string) => {
        await channel?.sendText(this.activeContext!.chatId, text);
      },
      sendCard: async (card: unknown) => {
        await channel?.sendCard(this.activeContext!.chatId, card);
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
    // 停止 Cron 调度器
    if (this.cronScheduler) {
      this.cronScheduler.stop();
    }

    await this.toolRegistry.stopAll();
    await this.agent.shutdown();

    for (const channel of this.channels.values()) {
      channel.disconnect();
    }

    this.logger.info('[Gateway] Shutdown complete');
  }
}