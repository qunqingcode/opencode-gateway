/**
 * GitLab 工具
 */

import type { Logger } from '../types';
import { BaseTool } from './base';
import type { ToolDefinition, ToolResult, ToolContext } from './types';
import { GitLabClient } from '../clients/gitlab';
import {
  FeishuCardBuilder,
  ActionBuilder,
  createFeishuCardInteractionEnvelope,
  buildFeishuCardInteractionContext,
  FEISHU_CARD_DEFAULT_TTL_MS,
} from '../channels/feishu';

// ============================================================
// 配置
// ============================================================

export interface GitLabToolConfig {
  baseUrl: string;
  token: string;
  projectId: string | number;
}

// ============================================================
// GitLab 工具
// ============================================================

export class GitLabTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'gitlab',
    description: 'GitLab 代码仓库工具',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: '操作类型: get_branches, get_merge_requests, create_mr, create_branch' },
      },
      required: ['action'],
    },
  };

  private client: GitLabClient;

  constructor(config: GitLabToolConfig, logger: Logger) {
    super(logger);
    this.client = new GitLabClient({
      apiUrl: config.baseUrl,
      token: config.token,
      projectId: String(config.projectId),
    }, logger);
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const action = args.action as string;

    switch (action) {
      case 'get_branches':
        return this.getBranches(args);
      case 'get_merge_requests':
        return this.getMergeRequests(args);
      case 'create_mr':
        return this.createMR(args, context);
      case 'create_mr_confirm':
        return this.createMRConfirm(args);
      case 'create_branch':
        return this.createBranch(args);
      default:
        return this.error(`Unknown action: ${action}`);
    }
  }

  // ============================================================
  // 操作实现
  // ============================================================

  private async getBranches(args: Record<string, unknown>): Promise<ToolResult> {
    const branches = await this.client.getBranches();

    let filtered = branches;
    if (args.search) {
      const search = args.search as string;
      filtered = branches.filter((b) => b.name.includes(search));
    }

    return this.success(filtered.slice(0, 50));
  }

  private async getMergeRequests(args: Record<string, unknown>): Promise<ToolResult> {
    const state = args.state as 'open' | 'merged' | 'closed' | undefined;
    const mrs = await this.client.getMergeRequests(state);
    return this.success(mrs);
  }

  private async createMR(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    let content = `**源分支**: \`${args.sourceBranch}\`\n**目标分支**: \`${args.targetBranch}\`\n**标题**: ${args.title}`;
    if (args.changelogUrl) {
      content += `\n\n📄 **变更日志**: [查看](${args.changelogUrl})`;
    }

    const cardContext = buildFeishuCardInteractionContext({
      operatorOpenId: context.userId,
      chatId: context.chatId,
      expiresAt: Date.now() + FEISHU_CARD_DEFAULT_TTL_MS,
    });

    const confirmEnvelope = createFeishuCardInteractionEnvelope({
      kind: 'button',
      action: 'gitlab.create_mr_confirm',
      args: args as Record<string, string | number | boolean | null | undefined>,
      context: cardContext,
    });

    const cancelEnvelope = createFeishuCardInteractionEnvelope({
      kind: 'button',
      action: 'gitlab.cancel',
      context: cardContext,
    });

    const card = new FeishuCardBuilder()
      .setConfig({ wide_screen_mode: true, update_multi: true })
      .setHeader('🔀 创建 MR 确认', 'blue')
      .addMarkdown(content)
      .addActionRow(
        new ActionBuilder()
          .addPrimaryButton('确认创建', confirmEnvelope)
          .addDefaultButton('取消', cancelEnvelope)
          .build()
      )
      .build();

    await context.sendCard(card);

    return this.needsApproval(card, '已发送审批卡片');
  }

  private async createMRConfirm(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      let mrDescription = (args.description as string) || '';
      if (args.changelogUrl) {
        mrDescription = `## 变更日志\n\n${args.changelogUrl}\n\n---\n\n${mrDescription}`;
      }

      const mr = await this.client.createMergeRequest(
        args.sourceBranch as string,
        args.targetBranch as string,
        args.title as string,
        mrDescription
      );

      const successCard = new FeishuCardBuilder()
        .setConfig({ wide_screen_mode: true, update_multi: true })
        .setHeader('✅ MR 创建成功', 'green')
        .addMarkdown(`**标题**: ${args.title}\n**链接**: [查看 MR](${mr.url})`)
        .build();

      return {
        success: true,
        output: { message: 'MR 创建成功', url: mr.url },
        approvalCard: successCard,
      };
    } catch (error) {
      const errorCard = new FeishuCardBuilder()
        .setConfig({ wide_screen_mode: true, update_multi: true })
        .setHeader('❌ MR 创建失败', 'red')
        .addMarkdown(`**错误**: ${(error as Error).message}`)
        .build();

      return {
        success: false,
        error: (error as Error).message,
        approvalCard: errorCard,
      };
    }
  }

  private async createBranch(args: Record<string, unknown>): Promise<ToolResult> {
    const branch = await this.client.createBranch(
      args.name as string,
      args.ref as string | undefined
    );
    return this.success({ message: `分支 ${branch.name} 创建成功` });
  }
}