/**
 * 禅道工具
 */

import type { Logger } from '../types';
import { BaseTool } from './base';
import type { ToolDefinition, ToolResult, ToolContext } from './types';
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
// 禅道工具
// ============================================================

export class ZentaoTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'zentao',
    description: '禅道项目管理工具',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型: get_bug, get_bugs, close_bug, add_comment',
        },
      },
      required: ['action'],
    },
  };

  private client: ZentaoClient;

  constructor(config: ZentaoToolConfig, logger: Logger) {
    super(logger);
    this.client = new ZentaoClient({
      baseUrl: config.baseUrl,
      token: config.token,
      account: config.account,
      password: config.password,
      projectId: config.projectId,
    }, logger);
  }

  async start(): Promise<void> {
    await this.client.init();
    this.logger.info('[ZentaoTool] Started');
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const action = args.action as string;

    switch (action) {
      case 'get_bug':
        return this.getBug(args);
      case 'get_bugs':
        return this.getBugs(args);
      case 'close_bug':
        return this.closeBug(args);
      case 'add_comment':
        return this.addComment(args);
      default:
        return this.error(`Unknown action: ${action}`);
    }
  }

  // ============================================================
  // 操作实现
  // ============================================================

  private async getBug(args: Record<string, unknown>): Promise<ToolResult> {
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

  private async getBugs(args: Record<string, unknown>): Promise<ToolResult> {
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

  private async closeBug(args: Record<string, unknown>): Promise<ToolResult> {
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

  private async addComment(args: Record<string, unknown>): Promise<ToolResult> {
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