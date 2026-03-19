/**
 * 指令流水线
 * 
 * 统一调度所有指令处理器：
 * 1. 注册指令处理器
 * 2. 从 AI 响应中提取指令
 * 3. 构建审批卡片
 * 4. 处理用户交互
 */

import type {
  Command,
  CommandHandler,
  CommandContext,
  CommandResult,
  InteractionResult,
  InteractionEnvelope,
  CommandType,
  CardBuilder,
  CommandServices,
} from './types';

// ============================================================
// Pipeline 实现
// ============================================================

export class CommandPipeline {
  private handlers = new Map<CommandType, CommandHandler>();
  private _cardBuilder: CardBuilder | null = null;
  private _services: CommandServices | null = null;

  /**
   * 注册指令处理器
   */
  register(handler: CommandHandler): this {
    if (this.handlers.has(handler.type)) {
      console.warn(`[CommandPipeline] Handler for "${handler.type}" already registered, overwriting`);
    }
    this.handlers.set(handler.type, handler);
    return this;
  }

  /**
   * 设置卡片构建器
   */
  setCardBuilder(builder: CardBuilder): this {
    this._cardBuilder = builder;
    return this;
  }

  /**
   * 获取卡片构建器
   */
  get cardBuilder(): CardBuilder {
    if (!this._cardBuilder) {
      throw new Error('CardBuilder not set. Call setCardBuilder() first.');
    }
    return this._cardBuilder;
  }

  /**
   * 设置服务依赖
   */
  setServices(services: CommandServices): this {
    this._services = services;
    return this;
  }

  /**
   * 获取服务依赖
   */
  get services(): CommandServices {
    if (!this._services) {
      throw new Error('Services not set. Call setServices() first.');
    }
    return this._services;
  }

  /**
   * 获取已注册的指令类型列表
   */
  getRegisteredTypes(): CommandType[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * 检查是否已注册指定类型
   */
  hasHandler(type: CommandType): boolean {
    return this.handlers.has(type);
  }

  /**
   * 从 AI 响应文本中提取指令
   * 
   * 按注册顺序尝试解析，返回第一个成功解析的指令
   */
  extractCommand(text: string): Command | null {
    for (const handler of this.handlers.values()) {
      const command = handler.parse(text);
      if (command) {
        return command;
      }
    }
    return null;
  }

  /**
   * 构建卡片（封装 handler 访问）
   * 
   * @param command 指令对象
   * @param context 指令上下文
   * @returns 卡片数据
   */
  async buildCard(command: Command, context: CommandContext): Promise<unknown> {
    const handler = this.handlers.get(command.type);
    if (!handler) {
      throw new Error(`Unknown command type: ${command.type}`);
    }
    return handler.buildCard(command, context);
  }

  /**
   * 处理指令 - 构建卡片并发送
   */
  async processCommand(
    command: Command,
    context: CommandContext
  ): Promise<CommandResult> {
    const handler = this.handlers.get(command.type);
    if (!handler) {
      return { type: 'error', error: `Unknown command type: ${command.type}` };
    }

    try {
      // 构建卡片
      const card = await handler.buildCard(command, context);

      // 发送卡片
      if (context.messenger.sendCard) {
        await context.messenger.sendCard(context.chatId, card);
      }

      return { type: 'command', data: command };
    } catch (error) {
      return {
        type: 'error',
        error: `Failed to process command: ${(error as Error).message}`,
      };
    }
  }

  /**
   * 处理用户交互
   * 
   * 根据动作类型路由到对应的处理器
   */
  async handleInteraction(
    action: string,
    envelope: InteractionEnvelope,
    context: CommandContext
  ): Promise<InteractionResult> {
    // 解析动作类型: 'code_change.create_mr' -> ['code_change', 'create_mr']
    const [commandType] = action.split('.') as [CommandType, string];
    
    const handler = this.handlers.get(commandType);
    if (!handler) {
      return {
        toast: { type: 'error', content: `未知指令类型: ${commandType}` },
      };
    }

    try {
      return await handler.handleInteraction(action, envelope, context);
    } catch (error) {
      return {
        toast: { type: 'error', content: `处理失败: ${(error as Error).message}` },
      };
    }
  }

  /**
   * 检查是否有处理器能处理该动作
   */
  canHandleAction(action: string): boolean {
    const [commandType] = action.split('.');
    return this.handlers.has(commandType as CommandType);
  }
}

// ============================================================
// 单例实例
// ============================================================

let pipelineInstance: CommandPipeline | null = null;

/**
 * 获取全局 Pipeline 实例
 */
export function getCommandPipeline(): CommandPipeline {
  if (!pipelineInstance) {
    pipelineInstance = new CommandPipeline();
  }
  return pipelineInstance;
}

/**
 * 重置 Pipeline（用于测试）
 */
export function resetCommandPipeline(): void {
  pipelineInstance = null;
}