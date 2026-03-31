/**
 * 禅道工具集
 * 
 * 每个操作独立成一个工具，符合 MCP 标准风格
 */

import type { Logger } from '../types';
import { BaseTool } from './base';
import type { ToolDefinition, ToolResult, ToolContext, ITool } from './types';
import { ZentaoClient } from '../clients/zentao';

// ============================================================
// 配置
// ============================================================

export interface ZentaoToolConfig {
  baseUrl: string;
  token?: string;
  account?: string;
  password?: string;
  projectId?: string | number;
}

// ============================================================
// 工具定义
// ============================================================

/** 获取 Bug 详情 */
class GetBugTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'zentao.get_bug',
    description: '获取禅道 Bug 详情',
    inputSchema: {
      type: 'object',
      properties: {
        bugId: { type: 'number', description: 'Bug ID' },
      },
      required: ['bugId'],
    },
  };

  private client: ZentaoClient;

  constructor(client: ZentaoClient, logger: Logger) {
    super(logger);
    this.client = client;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const bugId = args.bugId as number;
    if (!bugId) {
      return this.error('bugId is required');
    }

    const bug = await this.client.getIssue(bugId);
    if (!bug) {
      return this.error(`Bug #${bugId} not found`);
    }

    return this.success(bug);
  }
}

/** 获取 Bug 列表 */
class GetBugsTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'zentao.get_bugs',
    description: '获取禅道 Bug 列表',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Bug 状态（可选）' },
        assignee: { type: 'string', description: '指派给谁（可选）' },
        page: { type: 'number', description: '页码（可选）' },
        pageSize: { type: 'number', description: '每页数量（可选）' },
      },
      required: [],
    },
  };

  private client: ZentaoClient;

  constructor(client: ZentaoClient, logger: Logger) {
    super(logger);
    this.client = client;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const result = await this.client.getIssues({
      status: args.status as string,
      assignee: args.assignee as string,
      page: args.page as number,
      pageSize: args.pageSize as number,
    });

    return this.success({
      bugs: result.issues,
      total: result.total,
    });
  }
}

/** 关闭 Bug（需审批） */
class CloseBugTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'zentao.close_bug',
    description: '关闭禅道 Bug（需要用户审批确认）',
    inputSchema: {
      type: 'object',
      properties: {
        bugId: { type: 'number', description: 'Bug ID' },
        comment: { type: 'string', description: '关闭评论（可选）' },
      },
      required: ['bugId'],
    },
    requiresApproval: true,
  };

  private client: ZentaoClient;

  constructor(client: ZentaoClient, logger: Logger) {
    super(logger);
    this.client = client;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const bugId = args.bugId as number;
    if (!bugId) {
      return this.error('bugId is required');
    }

    const comment = args.comment as string | undefined;

    if (comment) {
      await this.client.addComment(bugId, comment);
    }

    await this.client.closeIssue(bugId);

    return this.success({
      message: `Bug #${bugId} closed successfully`,
    });
  }
}

/** 添加评论 */
class AddCommentTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'zentao.add_comment',
    description: '给禅道 Bug 添加评论',
    inputSchema: {
      type: 'object',
      properties: {
        bugId: { type: 'number', description: 'Bug ID' },
        comment: { type: 'string', description: '评论内容' },
      },
      required: ['bugId', 'comment'],
    },
  };

  private client: ZentaoClient;

  constructor(client: ZentaoClient, logger: Logger) {
    super(logger);
    this.client = client;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const bugId = args.bugId as number;
    const comment = args.comment as string;

    if (!bugId || !comment) {
      return this.error('bugId and comment are required');
    }

    await this.client.addComment(bugId, comment);

    return this.success({
      message: `Comment added to Bug #${bugId}`,
    });
  }
}

// ============================================================
// 工具集工厂
// ============================================================

/**
 * 禅道工具集
 * 
 * 创建所有禅道相关的独立工具
 */
export async function createZentaoTools(config: ZentaoToolConfig, logger: Logger): Promise<ITool[]> {
  const client = new ZentaoClient({
    baseUrl: config.baseUrl,
    token: config.token,
    account: config.account,
    password: config.password,
    projectId: config.projectId,
  }, logger);

  // 初始化客户端
  await client.init();

  return [
    new GetBugTool(client, logger),
    new GetBugsTool(client, logger),
    new CloseBugTool(client, logger),
    new AddCommentTool(client, logger),
  ];
}