/**
 * 工具注册表测试
 */

import { ToolRegistry } from '../../src/tools/registry';
import { BaseTool } from '../../src/tools/base';
import type { ToolDefinition, ToolResult, ToolContext } from '../../src/tools/types';
import type { Logger } from '../../src/types';

// Mock logger
const mockLogger: Logger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

// Mock context
const mockContext: ToolContext = {
  chatId: 'test-chat',
  userId: 'test-user',
  messageId: 'test-msg',
  sessionId: 'test-session',
  sendText: jest.fn(),
  sendCard: jest.fn(),
  logger: mockLogger,
};

// Mock tool implementation
class MockTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'test.tool',
    description: 'A test tool',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'A test value' },
      },
      required: ['value'],
    },
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    return this.success({ received: args.value });
  }
}

// Mock tool with lifecycle methods
class MockToolWithLifecycle extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'test.tool.with.lifecycle',
    description: 'A test tool with lifecycle',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  };

  startCalls = 0;
  stopCalls = 0;

  async execute(): Promise<ToolResult> {
    return this.success({ message: 'ok' });
  }

  async start(): Promise<void> {
    this.startCalls++;
  }

  async stop(): Promise<void> {
    this.stopCalls++;
  }
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry(mockLogger);
    jest.clearAllMocks();
  });

  describe('构造函数', () => {
    it('应该创建空的注册表', () => {
      expect(registry.names()).toEqual([]);
      expect(registry.list()).toEqual([]);
    });
  });

  describe('注册工具', () => {
    it('应该注册单个工具', () => {
      const tool = new MockTool(mockLogger);
      registry.register(tool);

      expect(registry.names()).toEqual(['test.tool']);
      expect(registry.has('test.tool')).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('[ToolRegistry] Registered: test.tool');
    });

    it('应该批量注册工具', () => {
      const tools = [
        new MockTool(mockLogger),
        new MockToolWithLifecycle(mockLogger),
      ];

      registry.registerAll(tools);

      expect(registry.names()).toEqual(['test.tool', 'test.tool.with.lifecycle']);
      expect(mockLogger.info).toHaveBeenCalledTimes(2);
    });

    it('应该覆盖同名工具', () => {
      const tool1 = new MockTool(mockLogger);
      const tool2 = new MockTool(mockLogger);

      registry.register(tool1);
      registry.register(tool2);

      expect(registry.names()).toEqual(['test.tool']);
      expect(registry.get('test.tool')).toBe(tool2);
    });
  });

  describe('注销工具', () => {
    it('应该注销工具', () => {
      const tool = new MockTool(mockLogger);
      registry.register(tool);

      const result = registry.unregister('test.tool');

      expect(result).toBe(true);
      expect(registry.has('test.tool')).toBe(false);
    });

    it('应该返回 false 当工具不存在', () => {
      const result = registry.unregister('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('查询工具', () => {
    it('应该获取工具', () => {
      const tool = new MockTool(mockLogger);
      registry.register(tool);

      const retrieved = registry.get('test.tool');

      expect(retrieved).toBe(tool);
    });

    it('应该返回 undefined 当工具不存在', () => {
      const retrieved = registry.get('nonexistent');

      expect(retrieved).toBeUndefined();
    });

    it('应该列出所有工具定义', () => {
      const tool1 = new MockTool(mockLogger);
      const tool2 = new MockToolWithLifecycle(mockLogger);

      registry.registerAll([tool1, tool2]);

      const definitions = registry.list();

      expect(definitions).toHaveLength(2);
      expect(definitions[0].name).toBe('test.tool');
      expect(definitions[1].name).toBe('test.tool.with.lifecycle');
    });

    it('应该列出公共工具（排除内部工具）', () => {
      const internalTool = new MockTool(mockLogger);
      (internalTool.definition as any).internal = true;

      const publicTool = new MockToolWithLifecycle(mockLogger);

      registry.registerAll([internalTool, publicTool]);

      const definitions = registry.listPublic();

      expect(definitions).toHaveLength(1);
      expect(definitions[0].name).toBe('test.tool.with.lifecycle');
    });
  });

  describe('执行工具', () => {
    it('应该执行工具并返回结果', async () => {
      const tool = new MockTool(mockLogger);
      registry.register(tool);

      const result = await registry.execute('test.tool', { value: 'test' }, mockContext);

      expect(result.success).toBe(true);
      expect(result.output).toEqual({ received: 'test' });
      expect(mockLogger.info).toHaveBeenCalledWith('[ToolRegistry] Executing: test.tool');
      expect(mockLogger.info).toHaveBeenCalledWith('[ToolRegistry] Result: test.tool - success');
    });

    it('应该返回错误当工具不存在', async () => {
      const result = await registry.execute('nonexistent', {}, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Tool not found');
      expect(mockLogger.warn).toHaveBeenCalledWith('[ToolRegistry] Tool not found: nonexistent');
    });

    it('应该捕获工具执行错误', async () => {
      const errorTool = new class extends BaseTool {
        readonly definition: ToolDefinition = {
          name: 'test.error.tool',
          description: 'A tool that errors',
          inputSchema: { type: 'object', properties: {}, required: [] },
        };

        async execute(): Promise<ToolResult> {
          throw new Error('Tool error');
        }
      }(mockLogger);

      registry.register(errorTool);

      const result = await registry.execute('test.error.tool', {}, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Tool error');
      expect(mockLogger.error).toHaveBeenCalledWith('[ToolRegistry] Error: test.error.tool - Tool error');
    });

    it('应该支持工具上下文', async () => {
      const contextAwareTool = new class extends BaseTool {
        readonly definition: ToolDefinition = {
          name: 'test.context.tool',
          description: 'A context aware tool',
          inputSchema: { type: 'object', properties: {}, required: [] },
        };

        contextReceived: ToolContext | null = null;

        async execute(_args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
          this.contextReceived = context;
          return this.success({ ok: true });
        }
      }(mockLogger);

      registry.register(contextAwareTool);

      const context: ToolContext = {
        chatId: 'test-chat',
        userId: 'test-user',
        messageId: 'test-msg',
        sessionId: 'test-session',
        sendText: jest.fn(),
        sendCard: jest.fn(),
        logger: mockLogger,
      };

      await registry.execute('test.context.tool', {}, context);

      expect(contextAwareTool.contextReceived).toEqual(context);
    });
  });

  describe('生命周期管理', () => {
    it('应该启动所有工具', async () => {
      const tool = new MockToolWithLifecycle(mockLogger);
      registry.register(tool);

      await registry.startAll();

      expect(tool.startCalls).toBe(1);
      expect(mockLogger.info).toHaveBeenCalledWith('[ToolRegistry] Started: test.tool.with.lifecycle');
    });

    it('应该捕获工具启动错误', async () => {
      const errorTool = new class extends MockTool {
        readonly definition: ToolDefinition = {
          name: 'test.error.start',
          description: 'Tool that fails to start',
          inputSchema: { type: 'object', properties: {}, required: [] },
        };

        async start(): Promise<void> {
          throw new Error('Start failed');
        }
      }(mockLogger);

      registry.register(errorTool);

      await registry.startAll();

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[ToolRegistry] Start failed: test.error.start - Start failed'
      );
    });

    it('应该停止所有工具', async () => {
      const tool = new MockToolWithLifecycle(mockLogger);
      registry.register(tool);

      await registry.stopAll();

      expect(tool.stopCalls).toBe(1);
      expect(mockLogger.info).toHaveBeenCalledWith('[ToolRegistry] Stopped: test.tool.with.lifecycle');
    });

    it('应该捕获工具停止错误', async () => {
      const errorTool = new class extends MockTool {
        readonly definition: ToolDefinition = {
          name: 'test.error.stop',
          description: 'Tool that fails to stop',
          inputSchema: { type: 'object', properties: {}, required: [] },
        };

        async stop(): Promise<void> {
          throw new Error('Stop failed');
        }
      }(mockLogger);

      registry.register(errorTool);

      await registry.stopAll();

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[ToolRegistry] Stop failed: test.error.stop - Stop failed'
      );
    });

    it('应该只启动有 start 方法的工具', async () => {
      const toolWithoutLifecycle = new MockTool(mockLogger);
      const toolWithLifecycle = new MockToolWithLifecycle(mockLogger);

      registry.registerAll([toolWithoutLifecycle, toolWithLifecycle]);

      await registry.startAll();

      expect(toolWithLifecycle.startCalls).toBe(1);
    });

    it('应该只停止有 stop 方法的工具', async () => {
      const toolWithoutLifecycle = new MockTool(mockLogger);
      const toolWithLifecycle = new MockToolWithLifecycle(mockLogger);

      registry.registerAll([toolWithoutLifecycle, toolWithLifecycle]);

      await registry.stopAll();

      expect(toolWithLifecycle.stopCalls).toBe(1);
    });
  });
});