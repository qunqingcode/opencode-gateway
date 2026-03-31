/**
 * Workflow 工具
 * 
 * 跨平台工作流编排（GitLab + 禅道）
 */

import type { Logger } from '../types';
import { BaseTool } from './base';
import type { ToolDefinition, ToolResult, ToolContext } from './types';
import { GitLabClient } from '../clients/gitlab';
import { ZentaoClient } from '../clients/zentao';
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

export interface WorkflowToolConfig {
  gitlab: {
    baseUrl: string;
    token: string;
    projectId: string | number;
  };
  zentao: {
    baseUrl: string;
    token?: string;
    account?: string;
    password?: string;
    projectId?: string | number;
  };
}

// ============================================================
// Workflow 工具
// ============================================================

export class WorkflowTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'workflow',
    description: '跨平台工作流工具（GitLab + 禅道）',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作: merge_and_close_bug, create_mr_for_bug, get_linked_bugs',
        },
      },
      required: ['action'],
    },
  };

  private gitlab: GitLabClient;
  private zentao: ZentaoClient;

  constructor(config: WorkflowToolConfig, logger: Logger) {
    super(logger);

    this.gitlab = new GitLabClient({
      apiUrl: config.gitlab.baseUrl,
      token: config.gitlab.token,
      projectId: String(config.gitlab.projectId),
    }, logger);

    this.zentao = new ZentaoClient({
      baseUrl: config.zentao.baseUrl,
      token: config.zentao.token,
      account: config.zentao.account,
      password: config.zentao.password,
      projectId: config.zentao.projectId,
    }, logger);
  }

  async start(): Promise<void> {
    await this.zentao.init();
    this.logger.info('[WorkflowTool] Started');
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const action = args.action as string;

    switch (action) {
      case 'merge_and_close_bug':
        return this.mergeAndCloseBug(args, context);
      case 'merge_and_close_bug_confirm':
        return this.mergeAndCloseBugConfirm(args);
      case 'create_mr_for_bug':
        return this.createMRForBug(args, context);
      case 'create_mr_for_bug_confirm':
        return this.createMRForBugConfirm(args);
      case 'get_linked_bugs':
        return this.getLinkedBugs(args);
      default:
        return this.error(`Unknown action: ${action}`);
    }
  }

  // ============================================================
  // 合并 MR 并关闭 Bug
  // ============================================================

  private async mergeAndCloseBug(
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const mrId = args.mrId as number;
    const bugId = args.bugId as number;

    // 获取 MR 和 Bug 信息
    const mrs = await this.gitlab.getMergeRequests('open');
    const mr = mrs.find((m) => m.id === mrId);
    const bug = await this.zentao.getIssue(bugId);

    let content = '';
    if (mr) {
      content += `### Merge Request !${mrId}\n**标题**: ${mr.title}\n**链接**: [查看 MR](${mr.url})\n\n`;
    }
    if (bug) {
      content += `### 禅道 Bug #${bugId}\n**标题**: ${bug.title}\n**状态**: ${bug.status}`;
    }

    const cardContext = buildFeishuCardInteractionContext({
      operatorOpenId: context.userId,
      chatId: context.chatId,
      expiresAt: Date.now() + FEISHU_CARD_DEFAULT_TTL_MS,
    });

    const card = new FeishuCardBuilder()
      .setConfig({ wide_screen_mode: true, update_multi: true })
      .setHeader('🔄 合并 MR 并关闭 Bug', 'blue')
      .addMarkdown(content)
      .addActionRow(
        new ActionBuilder()
          .addPrimaryButton(
            '确认执行',
            createFeishuCardInteractionEnvelope({
              kind: 'button',
              action: 'workflow.merge_and_close_bug_confirm',
              args: args as Record<string, string | number | boolean | null | undefined>,
              context: cardContext,
            })
          )
          .addDefaultButton(
            '取消',
            createFeishuCardInteractionEnvelope({
              kind: 'button',
              action: 'workflow.cancel',
              context: cardContext,
            })
          )
          .build()
      )
      .build();

    await context.sendCard(card);
    return this.needsApproval(card);
  }

  private async mergeAndCloseBugConfirm(args: Record<string, unknown>): Promise<ToolResult> {
    const mrId = args.mrId as number;
    const bugId = args.bugId as number;
    const comment = (args.comment as string) || `已通过 Merge Request !${mrId} 修复此 Bug`;

    const results: { step: string; status: string; message: string }[] = [];

    // 合并 MR
    try {
      await this.gitlab.mergeMergeRequest(mrId);
      results.push({ step: '合并 MR', status: 'success', message: `MR !${mrId} 已合并` });
    } catch (error) {
      results.push({ step: '合并 MR', status: 'error', message: (error as Error).message });
    }

    // 添加评论
    try {
      await this.zentao.addComment(bugId, comment);
      results.push({ step: '添加评论', status: 'success', message: '评论已添加' });
    } catch (error) {
      results.push({ step: '添加评论', status: 'error', message: (error as Error).message });
    }

    // 关闭 Bug
    try {
      await this.zentao.closeIssue(bugId);
      results.push({ step: '关闭 Bug', status: 'success', message: `Bug #${bugId} 已关闭` });
    } catch (error) {
      results.push({ step: '关闭 Bug', status: 'error', message: (error as Error).message });
    }

    const allSuccess = results.every((r) => r.status === 'success');
    const card = new FeishuCardBuilder()
      .setConfig({ wide_screen_mode: true, update_multi: true })
      .setHeader(allSuccess ? '✅ 工作流完成' : '⚠️ 部分失败', allSuccess ? 'green' : 'orange')
      .addMarkdown(results.map((r) => `${r.status === 'success' ? '✅' : '❌'} ${r.step}: ${r.message}`).join('\n'))
      .build();

    return { success: allSuccess, output: { results }, approvalCard: card };
  }

  // ============================================================
  // 为 Bug 创建 MR
  // ============================================================

  private async createMRForBug(
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const bugId = args.bugId as number;
    const bug = await this.zentao.getIssue(bugId);

    if (!bug) {
      return this.error(`Bug #${bugId} 不存在`);
    }

    const branchName = (args.branchName as string) || `fix/bug-${bugId}`;
    const targetBranch = (args.targetBranch as string) || 'main';
    const title = (args.title as string) || `fix: ${bug.title}`;

    const content = `### 禅道 Bug #${bugId}\n**标题**: ${bug.title}\n\n### 将创建\n**分支**: \`${branchName}\`\n**目标**: \`${targetBranch}\`\n**MR 标题**: ${title}`;

    const cardContext = buildFeishuCardInteractionContext({
      operatorOpenId: context.userId,
      chatId: context.chatId,
      expiresAt: Date.now() + FEISHU_CARD_DEFAULT_TTL_MS,
    });

    const card = new FeishuCardBuilder()
      .setConfig({ wide_screen_mode: true, update_multi: true })
      .setHeader('🔧 为 Bug 创建修复 MR', 'blue')
      .addMarkdown(content)
      .addActionRow(
        new ActionBuilder()
          .addPrimaryButton(
            '确认创建',
            createFeishuCardInteractionEnvelope({
              kind: 'button',
              action: 'workflow.create_mr_for_bug_confirm',
              args: { bugId, branchName, targetBranch, title },
              context: cardContext,
            })
          )
          .addDefaultButton(
            '取消',
            createFeishuCardInteractionEnvelope({
              kind: 'button',
              action: 'workflow.cancel',
              context: cardContext,
            })
          )
          .build()
      )
      .build();

    await context.sendCard(card);
    return this.needsApproval(card);
  }

  private async createMRForBugConfirm(args: Record<string, unknown>): Promise<ToolResult> {
    const { bugId, branchName, targetBranch, title } = args as {
      bugId: number;
      branchName: string;
      targetBranch: string;
      title: string;
    };

    const results: { step: string; status: string; message: string }[] = [];

    // 创建分支
    try {
      await this.gitlab.createBranch(branchName, targetBranch);
      results.push({ step: '创建分支', status: 'success', message: `分支 ${branchName} 已创建` });
    } catch (error) {
      results.push({ step: '创建分支', status: 'error', message: (error as Error).message });
    }

    // 创建 MR
    try {
      const mr = await this.gitlab.createMergeRequest(branchName, targetBranch, title, `关联 Bug: #${bugId}`);
      results.push({ step: '创建 MR', status: 'success', message: `MR !${mr.id} 已创建` });
    } catch (error) {
      results.push({ step: '创建 MR', status: 'error', message: (error as Error).message });
    }

    // 更新 Bug
    try {
      await this.zentao.addComment(bugId, `已创建修复分支 ${branchName}`);
      results.push({ step: '更新 Bug', status: 'success', message: '已添加修复记录' });
    } catch (error) {
      results.push({ step: '更新 Bug', status: 'error', message: (error as Error).message });
    }

    const allSuccess = results.every((r) => r.status === 'success');
    const card = new FeishuCardBuilder()
      .setConfig({ wide_screen_mode: true, update_multi: true })
      .setHeader(allSuccess ? '✅ 创建成功' : '⚠️ 部分失败', allSuccess ? 'green' : 'orange')
      .addMarkdown(results.map((r) => `${r.status === 'success' ? '✅' : '❌'} ${r.step}: ${r.message}`).join('\n'))
      .build();

    return { success: allSuccess, output: { results }, approvalCard: card };
  }

  // ============================================================
  // 获取关联的 Bug
  // ============================================================

  private async getLinkedBugs(args: Record<string, unknown>): Promise<ToolResult> {
    const mrId = args.mrId as number;
    const mrs = await this.gitlab.getMergeRequests();
    const mr = mrs.find((m) => m.id === mrId);

    if (!mr) {
      return this.error(`MR !${mrId} 不存在`);
    }

    // 从描述中提取 Bug ID
    const description = mr.description || '';
    const bugPattern = /(?:bug|#)\s*(\d+)/gi;
    const bugIds: number[] = [];
    let match;

    while ((match = bugPattern.exec(description)) !== null) {
      const bugId = parseInt(match[1], 10);
      if (!bugIds.includes(bugId)) {
        bugIds.push(bugId);
      }
    }

    const bugs = await Promise.all(bugIds.map((id) => this.zentao.getIssue(id)));

    return this.success({
      mr: { id: mr.id, title: mr.title, url: mr.url },
      linkedBugs: bugs.filter(Boolean),
    });
  }
}