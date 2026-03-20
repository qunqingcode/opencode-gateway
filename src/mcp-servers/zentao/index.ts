/**
 * 禅道 MCP Server
 * 
 * 封装禅道 API 为 MCP 工具
 */

import { BaseMCPServer } from '../base';
import { createTool, ToolDefinition } from '../types';
import type { ToolContext } from '../../gateway/types';
import type { Logger } from '../../channels/types';
import { ZentaoProvider } from '../../providers/zentao';
import {
  FeishuCardBuilder,
  ActionBuilder,
  createFeishuCardInteractionEnvelope,
  buildFeishuCardInteractionContext,
  FEISHU_CARD_DEFAULT_TTL_MS,
} from '../../providers/feishu/card';

// ============================================================
// 配置
// ============================================================

export interface ZentaoMCPServerConfig {
  baseUrl: string;
  token?: string;
  account?: string;
  password?: string;
  projectId?: string | number;
}

// ============================================================
// Zentao MCP Server 实现
// ============================================================

export class ZentaoMCPServer extends BaseMCPServer {
  readonly name = 'zentao';
  readonly description = '禅道项目管理工具';

  private provider: ZentaoProvider;

  constructor(config: ZentaoMCPServerConfig, logger: Logger) {
    super(config as unknown as Record<string, unknown>, logger);

    this.provider = new ZentaoProvider({
      id: 'zentao-mcp',
      type: 'issue',
      enabled: true,
      capabilities: ['issues', 'project'],
      baseUrl: config.baseUrl,
      token: config.token,
      account: config.account,
      password: config.password,
      projectId: config.projectId,
    }, logger);

    this.registerTools(this.createTools());
  }

  // ============================================================
  // 工具定义
  // ============================================================

  private createTools(): ToolDefinition[] {
    return [
      // ========== 查询类工具 (无需审批) ==========
      createTool({
        name: 'get_bug',
        description: '获取禅道 Bug 详情',
        inputSchema: {
          type: 'object',
          properties: {
            bugId: { type: 'number', description: 'Bug ID' },
          },
          required: ['bugId'],
        },
        execute: async (args) => {
          const issue = await this.provider.getIssue(args.bugId as number);
          if (!issue) {
            return { success: false, error: `Bug #${args.bugId} 不存在` };
          }
          return { success: true, output: issue };
        },
      }),

      createTool({
        name: 'list_bugs',
        description: '查询 Bug 列表',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', description: '状态筛选 (active, closed, resolved)' },
            assignee: { type: 'string', description: '指派人筛选' },
            limit: { type: 'number', description: '返回数量限制' },
          },
        },
        execute: async (args) => {
          const result = await this.provider.getIssues({
            status: args.status as string,
            assignee: args.assignee as string,
          });
          const issues = result.issues.slice(0, (args.limit as number) || 20);
          return { success: true, output: { issues, total: result.total } };
        },
      }),

      // ========== 创建类工具 (需要审批) ==========
      createTool({
        name: 'create_bug',
        description: '创建禅道 Bug (需要审批)',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Bug 标题' },
            description: { type: 'string', description: 'Bug 描述' },
            priority: { type: 'string', description: '优先级 (critical, high, medium, low)' },
            type: { type: 'string', description: '类型 (bug, task, feature, story)' },
            assignee: { type: 'string', description: '指派给' },
          },
          required: ['title'],
        },
        requiresApproval: true,
        execute: async (args, context: ToolContext) => {
          const content = `**标题**: ${args.title}\n**优先级**: ${args.priority || '中'}\n**类型**: ${args.type || 'bug'}`;

          const cardContext = buildFeishuCardInteractionContext({
            operatorOpenId: context.userId,
            chatId: context.chatId,
            expiresAt: Date.now() + FEISHU_CARD_DEFAULT_TTL_MS,
          });

          const confirmEnvelope = createFeishuCardInteractionEnvelope({
            kind: 'button',
            action: 'zentao.create_bug_confirm',
            args: args as unknown as Record<string, string | number | boolean | null | undefined>,
            context: cardContext,
          });

          const cancelEnvelope = createFeishuCardInteractionEnvelope({
            kind: 'button',
            action: 'zentao.cancel',
            context: cardContext,
          });

          const card = new FeishuCardBuilder()
            .setHeader('🐛 创建 Bug 确认', 'purple')
            .addMarkdown(content)
            .addActionRow(new ActionBuilder()
              .addPrimaryButton('确认创建', confirmEnvelope)
              .addDefaultButton('取消', cancelEnvelope)
              .build())
            .build();

          await context.sendCard(card);

          return {
            success: true,
            requiresApproval: true,
            output: '已发送审批卡片，等待用户确认',
            approvalCard: card,
          };
        },
      }),

      createTool({
        name: 'create_bug_confirm',
        description: '确认创建 Bug (内部工具)',
        internal: true, // 不暴露给 AI
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Bug 标题' },
            description: { type: 'string', description: 'Bug 描述' },
            priority: { type: 'string', description: '优先级' },
            type: { type: 'string', description: '类型' },
            assignee: { type: 'string', description: '指派给' },
          },
          required: ['title'],
        },
        execute: async (args) => {
          const issue = await this.provider.createIssue({
            title: args.title as string,
            description: args.description as string,
            priority: args.priority as 'critical' | 'high' | 'medium' | 'low',
            type: args.type as 'bug' | 'task' | 'feature' | 'story',
            assignee: args.assignee as string,
          });
          return {
            success: true,
            output: {
              message: `Bug #${issue.id} 创建成功`,
              issue,
            },
          };
        },
      }),

      // ========== 关闭类工具 (需要审批) ==========
      createTool({
        name: 'close_bug',
        description: '关闭 Bug (需要审批)',
        inputSchema: {
          type: 'object',
          properties: {
            bugId: { type: 'number', description: 'Bug ID' },
          },
          required: ['bugId'],
        },
        requiresApproval: true,
        execute: async (args, context: ToolContext) => {
          const content = `确认关闭 Bug #${args.bugId}？`;

          const cardContext = buildFeishuCardInteractionContext({
            operatorOpenId: context.userId,
            chatId: context.chatId,
            expiresAt: Date.now() + FEISHU_CARD_DEFAULT_TTL_MS,
          });

          const confirmEnvelope = createFeishuCardInteractionEnvelope({
            kind: 'button',
            action: 'zentao.close_bug_confirm',
            args: args as unknown as Record<string, string | number | boolean | null | undefined>,
            context: cardContext,
          });

          const cancelEnvelope = createFeishuCardInteractionEnvelope({
            kind: 'button',
            action: 'zentao.cancel',
            context: cardContext,
          });

          const card = new FeishuCardBuilder()
            .setHeader('✅ 关闭 Bug 确认', 'green')
            .addMarkdown(content)
            .addActionRow(new ActionBuilder()
              .addPrimaryButton('确认关闭', confirmEnvelope)
              .addDefaultButton('取消', cancelEnvelope)
              .build())
            .build();

          await context.sendCard(card);

          return {
            success: true,
            requiresApproval: true,
            output: '已发送审批卡片',
            approvalCard: card,
          };
        },
      }),

      createTool({
        name: 'close_bug_confirm',
        description: '确认关闭 Bug (内部工具)',
        internal: true, // 不暴露给 AI
        inputSchema: {
          type: 'object',
          properties: {
            bugId: { type: 'number', description: 'Bug ID' },
          },
          required: ['bugId'],
        },
        execute: async (args) => {
          await this.provider.closeIssue(args.bugId as number);
          return { success: true, output: `Bug #${args.bugId} 已关闭` };
        },
      }),

      // ========== 评论工具 ==========
      createTool({
        name: 'add_comment',
        description: '添加评论到 Bug',
        inputSchema: {
          type: 'object',
          properties: {
            bugId: { type: 'number', description: 'Bug ID' },
            comment: { type: 'string', description: '评论内容' },
          },
          required: ['bugId', 'comment'],
        },
        execute: async (args) => {
          await this.provider.addComment(args.bugId as number, args.comment as string);
          return { success: true, output: `已为 Bug #${args.bugId} 添加评论` };
        },
      }),

      // ========== 取消操作 ==========
      createTool({
        name: 'cancel',
        description: '取消操作',
        internal: true, // 不暴露给 AI
        inputSchema: {
          type: 'object',
          properties: {},
        },
        execute: async () => {
          return { success: true, output: '操作已取消' };
        },
      }),
    ];
  }

  // ============================================================
  // 生命周期
  // ============================================================

  async start(): Promise<void> {
    await this.provider.start();
    await super.start();
  }

  async stop(): Promise<void> {
    await super.stop();
  }
}

// ============================================================
// 工厂函数
// ============================================================

export function createZentaoMCPServer(
  config: ZentaoMCPServerConfig,
  logger: Logger
): ZentaoMCPServer {
  return new ZentaoMCPServer(config, logger);
}