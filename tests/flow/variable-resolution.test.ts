/**
 * Flow 引擎变量解析测试
 * 
 * 测试目标：
 * 1. 验证 tool 步骤的输出存储结构
 * 2. 验证 agent 步骤的输出存储结构
 * 3. 验证变量解析逻辑 (${step_id.field} vs ${outputs.step_id.field})
 * 4. 发现潜在的数据流问题
 */

import { FlowEngine } from '../../src/flow/engine';
import { ToolRegistry } from '../../src/tools/registry';
import { BaseTool } from '../../src/tools/base';
import type { ToolDefinition, ToolResult, ToolContext } from '../../src/tools/types';
import type { FlowTemplate } from '../../src/flow/types';
import type { Logger } from '../../src/types';

// ============================================================
// Mock 依赖
// ============================================================

const mockLogger: Logger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

const mockContext: ToolContext = {
  chatId: 'test-chat',
  userId: 'test-user',
  messageId: 'test-msg',
  sessionId: 'test-session',
  sendText: jest.fn(),
  sendCard: jest.fn(),
  logger: mockLogger,
};

// Mock Agent
const mockAgent = {
  name: 'mock_agent',
  createSession: jest.fn().mockResolvedValue('test-session'),
  sendPrompt: jest.fn().mockResolvedValue('Mock agent response'),
};

// ============================================================
// Mock Tools
// ============================================================

// Mock GitLab Tool - 模拟 zentao.get_bug 的返回结构
class MockGetBugTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'mock.get_bug',
    description: 'Mock bug retrieval tool',
    inputSchema: {
      type: 'object',
      properties: {
        bugId: { type: 'number', description: 'Bug ID' },
      },
      required: ['bugId'],
    },
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    // 模拟真实 zentao.get_bug 的返回：this.success(bugObject)
    return this.success({
      id: args.bugId,
      title: `Bug #${args.bugId}`,
      description: 'Test bug description',
      severity: 'high',
      status: 'active',
    });
  }
}

// Mock GitLab Tool - 模拟 gitlab.create_mr 的返回结构
class MockCreateMRTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'mock.create_mr',
    description: 'Mock MR creation tool',
    inputSchema: {
      type: 'object',
      properties: {
        sourceBranch: { type: 'string', description: 'Source branch' },
        targetBranch: { type: 'string', description: 'Target branch' },
        title: { type: 'string', description: 'MR title' },
      },
      required: ['sourceBranch', 'targetBranch', 'title'],
    },
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    // 模拟真实 gitlab.create_mr 的返回：this.success({ url, id, title })
    return this.success({
      url: `https://gitlab.com/mr/${args.sourceBranch}`,
      id: 123,
      title: args.title,
    });
  }
}

// ============================================================
// 测试套件
// ============================================================

describe('FlowEngine Variable Resolution', () => {
  let registry: ToolRegistry;
  let engine: FlowEngine;

  beforeEach(() => {
    registry = new ToolRegistry(mockLogger);
    registry.register(new MockGetBugTool(mockLogger));
    registry.register(new MockCreateMRTool(mockLogger));

    engine = new FlowEngine(registry, mockAgent as any, mockLogger);
    jest.clearAllMocks();
  });

  // ============================================================
  // 测试1：Tool 步骤输出结构
  // ============================================================

  describe('Tool 步骤输出结构', () => {
    it('应该返回 { success: true, output: {...} } 结构', async () => {
      const flow: FlowTemplate = {
        name: 'test-tool-output',
        steps: [
          {
            id: 'get_bug',
            tool: 'mock.get_bug',
            params: { bugId: 123 },
          },
        ],
      };

      const result = await engine.execute(flow, {}, mockContext);

      expect(result.success).toBe(true);
      // 检查 execution.outputs 的存储结构
      expect(result.output).toHaveProperty('outputs');
      const outputs = result.output as any;

      // 关键验证：outputs.get_bug 应该是完整的 ToolResult
      expect(outputs.outputs.get_bug).toEqual({
        success: true,
        output: {
          id: 123,
          title: 'Bug #123',
          description: 'Test bug description',
          severity: 'high',
          status: 'active',
        },
      });
    });

    it('存储的输出应该包含 success 和 output 字段', async () => {
      const flow: FlowTemplate = {
        name: 'test-storage-structure',
        steps: [
          {
            id: 'create_mr',
            tool: 'mock.create_mr',
            params: {
              sourceBranch: 'feature/test',
              targetBranch: 'main',
              title: 'Test MR',
            },
          },
        ],
      };

      const result = await engine.execute(flow, {}, mockContext);
      const outputs = (result.output as any).outputs;

      // 验证存储结构
      expect(outputs.create_mr).toHaveProperty('success');
      expect(outputs.create_mr).toHaveProperty('output');
      expect(outputs.create_mr.success).toBe(true);
      expect(outputs.create_mr.output).toHaveProperty('url');
      expect(outputs.create_mr.output).toHaveProperty('id');
    });
  });

  // ============================================================
  // 测试2：Agent 步骤输出结构
  // ============================================================

  describe('Agent 步骤输出结构', () => {
    it('应该返回 { success: true, output: { response: "..." } } 统一结构', async () => {
      const flow: FlowTemplate = {
        name: 'test-agent-output',
        steps: [
          {
            id: 'agent_step',
            agent: true,
            prompt: 'Test agent prompt',
          },
        ],
      };

      const result = await engine.execute(flow, {}, mockContext);
      const outputs = (result.output as any).outputs;

      // 关键验证：agent 步骤现在返回 { success: true, output: { response } }
      expect(outputs.agent_step).toEqual({
        success: true,
        output: {
          response: 'Mock agent response',
        },
      });

      // 注意：现在统一使用 output 字段
      expect(outputs.agent_step).toHaveProperty('output');
      expect(outputs.agent_step.output).toHaveProperty('response');
    });
  });

  // ============================================================
  // 测试3：变量解析 - Tool 步骤
  // ============================================================

  describe('变量解析 - Tool 步骤引用问题', () => {
    it('✅ 修复后: ${get_bug.title} 现在能正确解析数据', async () => {
      // 这个测试证明修复成功
      const flow: FlowTemplate = {
        name: 'test-bug-reference',
        steps: [
          {
            id: 'get_bug',
            tool: 'mock.get_bug',
            params: { bugId: 123 },
          },
          {
            id: 'use_bug_title',
            tool: 'mock.create_mr',
            params: {
              sourceBranch: 'fix/123',
              targetBranch: 'main',
              title: '${get_bug.title}', // ✅ 智能解析：自动添加 outputs 和 output 前缀
            },
          },
        ],
      };

      const result = await engine.execute(flow, {}, mockContext);

      expect(result.success).toBe(true);
      const outputs = (result.output as any).outputs;
      console.log('DEBUG: outputs structure:', JSON.stringify(outputs, null, 2));
      
      // ✅ 修复成功：title 正确解析为 "Bug #123"
      expect(outputs.use_bug_title.output.title).toBe('Bug #123');
    });

    it('✅ 正确写法: ${outputs.get_bug.output.title} 应该能找到数据', async () => {
      const flow: FlowTemplate = {
        name: 'test-correct-reference',
        steps: [
          {
            id: 'get_bug',
            tool: 'mock.get_bug',
            params: { bugId: 123 },
          },
          {
            id: 'use_bug_title',
            tool: 'mock.create_mr',
            params: {
              sourceBranch: 'fix/123',
              targetBranch: 'main',
              title: '${outputs.get_bug.output.title}', // ✅ 正确写法
            },
          },
        ],
      };

      const result = await engine.execute(flow, {}, mockContext);

      expect(result.success).toBe(true);
      const outputs = (result.output as any).outputs;

      // 验证 title 正确解析为 "Bug #123"
      expect(outputs.use_bug_title.output.title).toBe('Bug #123');
    });

    it('✅ 参数引用: ${params.bugId} 正确解析（变量替换为字符串）', async () => {
      const flow: FlowTemplate = {
        name: 'test-param-reference',
        params: {
          bugId: {
            type: 'number',
            required: true,
          },
        },
        steps: [
          {
            id: 'get_bug',
            tool: 'mock.get_bug',
            params: { bugId: '${params.bugId}' },
          },
        ],
      };

      const result = await engine.execute(flow, { bugId: 456 }, mockContext);

      expect(result.success).toBe(true);
      const outputs = (result.output as any).outputs;

      // 注意：变量替换会转为字符串，这是 resolveVariables 的预期行为
      expect(outputs.get_bug.output.id).toBe('456');
    });
  });

  // ============================================================
  // 测试4：变量解析 - Agent 步骤
  // ============================================================

  describe('变量解析 - Agent 步骤引用', () => {
    it('✅ ${select_mr.response} 现在应该能找到数据（统一结构后）', async () => {
      const flow: FlowTemplate = {
        name: 'test-agent-reference',
        steps: [
          {
            id: 'select_mr',
            agent: true,
            prompt: 'Select an MR',
          },
          {
            id: 'use_response',
            agent: true,
            prompt: '${select_mr.response}', // 现在自动解析为 outputs.select_mr.output.response
          },
        ],
      };

      const result = await engine.execute(flow, {}, mockContext);

      expect(result.success).toBe(true);
      const outputs = (result.output as any).outputs;

      // 验证新的统一结构
      expect(outputs.select_mr.output.response).toBe('Mock agent response');
      
      // 检查第二个 agent 的 prompt 是否被正确解析
      expect(mockAgent.sendPrompt).toHaveBeenCalledTimes(2);
      const secondPrompt = mockAgent.sendPrompt.mock.calls[1][1];
      expect(secondPrompt).toBe('Mock agent response');  // ${select_mr.response} 成功解析！
    });

    it('访问 ${select_mr.output} 会返回对象本身', async () => {
      const flow: FlowTemplate = {
        name: 'test-agent-output-structure',
        steps: [
          {
            id: 'select_mr',
            agent: true,
            prompt: 'Select an MR',
          },
          {
            id: 'use_output_object',
            agent: true,
            prompt: '${select_mr.output}', // 会解析为 output 对象本身
          },
        ],
      };

      const result = await engine.execute(flow, {}, mockContext);

      expect(result.success).toBe(true);
      const secondPrompt = mockAgent.sendPrompt.mock.calls[1][1];
      
      // ${select_mr.output} 会解析为 output 对象，转为字符串
      expect(secondPrompt).toBe('[object Object]');  // 对象转为字符串
    });
  });

  // ============================================================
  // 测试5：混合场景 - Tool + Agent
  // ============================================================

  describe('混合场景 - Tool + Agent 步骤', () => {
    it('应该正确处理 tool → agent → tool 的数据流（统一结构）', async () => {
      const flow: FlowTemplate = {
        name: 'test-mixed-flow',
        params: {
          bugId: {
            type: 'number',
            required: true,
          },
        },
        steps: [
          {
            id: 'get_bug',
            tool: 'mock.get_bug',
            params: { bugId: '${params.bugId}' },
          },
          {
            id: 'analyze_bug',
            agent: true,
            prompt: '分析 Bug: ${get_bug.title}',  // 智能解析
          },
          {
            id: 'create_mr',
            tool: 'mock.create_mr',
            params: {
              sourceBranch: 'fix/${params.bugId}',
              targetBranch: 'main',
              title: '${get_bug.title}',  // 智能解析
            },
          },
        ],
      };

      const result = await engine.execute(flow, { bugId: 789 }, mockContext);

      expect(result.success).toBe(true);
      const outputs = (result.output as any).outputs;

      // 验证整个流程的数据传递
      // 注意：变量替换会转为字符串
      expect(outputs.get_bug.output.id).toBe('789');
      expect(outputs.analyze_bug.output.response).toBe('Mock agent response');
      expect(outputs.create_mr.output.title).toBe('Bug #789');  // ✅ 智能解析成功！
      expect(outputs.create_mr.output.url).toContain('fix/789');

      console.log('完整数据流（统一结构）:', JSON.stringify(outputs, null, 2));
    });
  });

  // ============================================================
  // 测试6：真实模板模拟
  // ============================================================

  describe('真实模板模拟', () => {
    it('模拟 bug-fix-workflow.yaml 的数据流', async () => {
      // 简化版 bug-fix-workflow
      const flow: FlowTemplate = {
        name: 'bug-fix-workflow-test',
        params: {
          bugId: { type: 'number', required: true },
        },
        steps: [
          {
            id: 'get_bug',
            tool: 'mock.get_bug',
            params: { bugId: '${params.bugId}' },
          },
          {
            id: 'ai_analyze',
            agent: true,
            // ❌ 模板写法：${get_bug.title} - 缺少 outputs 和 output
            prompt: `
              Bug ID: \${params.bugId}
              标题: \${get_bug.title}
              描述: \${get_bug.description}
            `,
          },
          {
            id: 'create_mr',
            tool: 'mock.create_mr',
            params: {
              sourceBranch: 'fix/${params.bugId}',
              targetBranch: 'main',
              title: 'fix: ${get_bug.title}', // ❌ 模板写法
            },
          },
        ],
      };

      const result = await engine.execute(flow, { bugId: 123 }, mockContext);

      console.log('bug-fix-workflow 测试结果:', JSON.stringify(result, null, 2));

      // 这个测试会揭示模板变量引用的问题
      expect(result.success).toBe(true);
    });

    it('模拟 code-review-workflow.yaml 的数据流（统一结构）', async () => {
      // 简化版 code-review-workflow
      const flow: FlowTemplate = {
        name: 'code-review-workflow-test',
        steps: [
          {
            id: 'select_mr',
            agent: true,
            prompt: 'Select MR for review',
          },
          {
            id: 'analyze_code',
            agent: true,
            // ✅ 现在能正确解析：${select_mr.response} → outputs.select_mr.output.response
            prompt: `
              请审查以下 MR:
              \${select_mr.response}
            `,
          },
        ],
      };

      const result = await engine.execute(flow, {}, mockContext);

      console.log('code-review-workflow 测试结果:', JSON.stringify(result, null, 2));

      expect(result.success).toBe(true);
      expect(mockAgent.sendPrompt).toHaveBeenCalledTimes(2);
      
      // 验证 select_mr.response 能正确传递给 analyze_code
      const secondCallPrompt = mockAgent.sendPrompt.mock.calls[1][1];
      expect(secondCallPrompt).toContain('Mock agent response');  // ✅ 现在能成功解析！
    });
  });

  // ============================================================
  // 测试7：变量解析边界情况
  // ============================================================

  describe('变量解析边界情况', () => {
    it('应该处理不存在的变量路径', async () => {
      const flow: FlowTemplate = {
        name: 'test-missing-variable',
        steps: [
          {
            id: 'use_missing',
            agent: true,
            prompt: '${outputs.nonexistent.field}',
          },
        ],
      };

      const result = await engine.execute(flow, {}, mockContext);

      expect(result.success).toBe(true);
      const outputs = (result.output as any).outputs;
      
      // 验证 agent 步骤收到解析后的 prompt（undefined）
      expect(mockAgent.sendPrompt).toHaveBeenCalledTimes(1);
      const promptUsed = mockAgent.sendPrompt.mock.calls[0][1];
      
      // 应该被解析为 "undefined"
      expect(promptUsed).toBe('undefined');
    });

    it('应该处理深层嵌套路径', async () => {
      const flow: FlowTemplate = {
        name: 'test-deep-path',
        steps: [
          {
            id: 'get_bug',
            tool: 'mock.get_bug',
            params: { bugId: 123 },
          },
          {
            id: 'use_deep',
            agent: true,
            prompt: '${get_bug.severity}',  // 智能解析
          },
        ],
      };

      const result = await engine.execute(flow, {}, mockContext);

      expect(result.success).toBe(true);
      const outputs = (result.output as any).outputs;
      
      // 验证第一个步骤执行成功
      expect(outputs.get_bug.output.severity).toBe('high');
      
      // 验证第二个步骤收到解析后的 prompt
      expect(mockAgent.sendPrompt).toHaveBeenCalledTimes(1);
      const promptUsed = mockAgent.sendPrompt.mock.calls[0][1];
      
      expect(promptUsed).toBe('high');
    });
  });
});