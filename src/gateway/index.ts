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

    this.logger.info(`[OpenCode] Sending prompt to session ${sessionId}: ${prompt.slice(0, 100)}...`);

    const result = await Promise.race([
      this.opencodeClient.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: 'text' as const, text: prompt }],
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`AI 响应超时 (${timeout / 1000}s)`)), timeout)
      ),
    ]);

    // 记录 OpenCode 原始响应
    this.logger.info(`[OpenCode] Raw response: ${JSON.stringify(result?.data || {}).slice(0, 500)}`);

    if (!result.data?.parts) {
      this.logger.warn('[OpenCode] No parts in response');
      return null;
    }

    // 记录所有 parts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allParts = result.data.parts.map((p: any) => ({
      type: p.type,
      ignored: p.ignored,
      text: p.text?.slice(0, 100),
      tool: p.tool,
    }));
    this.logger.info(`[OpenCode] Parts: ${JSON.stringify(allParts)}`);

    // 提取文本内容
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const texts = result.data.parts
      .filter((p: any) => p.type === 'text' && !p.ignored && p.text)
      .map((p: any) => p.text!);

    const response = texts.join('\n\n') || null;
    this.logger.info(`[OpenCode] Final text response: ${response?.slice(0, 200) || '(empty)'}`);

    return response;
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

    return {
      toast: result.success
        ? { type: 'success', content: '操作成功' }
        : { type: 'error', content: result.error || '操作失败' },
      card: result.requiresApproval ? result.approvalCard : undefined,
    };
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