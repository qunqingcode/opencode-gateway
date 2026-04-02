/**
 * Workflow 工具集
 * 
 * 跨平台工作流编排（GitLab + 禅道）
 * 每个操作独立成一个工具，符合 MCP 标准风格
 */

import type { Logger } from '../types';
import { BaseTool } from './base';
import type { ToolDefinition, ToolResult, ToolContext, ITool } from './types';
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
// 共享客户端
// ============================================================

interface WorkflowClients {
  gitlab: GitLabClient;
  zentao: ZentaoClient;
}

// ============================================================
// 工具定义
// ============================================================

/** 获取关联的 Bug */
class GetLinkedBugsTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'workflow.get_linked_bugs',
    description: '从 MR 描述中提取关联的禅道 Bug',
    inputSchema: {
      type: 'object',
      properties: {
        mrId: { type: 'number', description: 'MR ID' },
      },
      required: ['mrId'],
    },
  };

  private clients: WorkflowClients;

  constructor(clients: WorkflowClients, logger: Logger) {
    super(logger);
    this.clients = clients;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const mrId = args.mrId as number;
    const mrs = await this.clients.gitlab.getMergeRequests();
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

    const bugs = await Promise.all(bugIds.map((id) => this.clients.zentao.getIssue(id)));

    return this.success({
      mr: { id: mr.id, title: mr.title, url: mr.url },
      linkedBugs: bugs.filter(Boolean),
    });
  }
}

/** 为 Bug 创建 MR（需审批） */
class CreateMRForBugTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'workflow.create_mr_for_bug',
    description: '为禅道 Bug 创建修复分支和 MR（需要用户审批确认）',
    inputSchema: {
      type: 'object',
      properties: {
        bugId: { type: 'number', description: 'Bug ID' },
        branchName: { type: 'string', description: '分支名称（可选，默认 fix/bug-{bugId}）' },
        targetBranch: { type: 'string', description: '目标分支（默认 main）' },
        title: { type: 'string', description: 'MR 标题（可选）' },
      },
      required: ['bugId'],
    },
    requiresApproval: true,
  };

  private clients: WorkflowClients;

  constructor(clients: WorkflowClients, logger: Logger) {
    super(logger);
    this.clients = clients;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const bugId = args.bugId as number;
    const bug = await this.clients.zentao.getIssue(bugId);

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
}

/** 为 Bug 创建 MR 确认（内部工具） */
class CreateMRForBugConfirmTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'workflow.create_mr_for_bug_confirm',
    description: '[内部工具] 确认创建 Bug 修复 MR（审批后调用）',
    inputSchema: {
      type: 'object',
      properties: {
        bugId: { type: 'number', description: 'Bug ID' },
        branchName: { type: 'string', description: '分支名称' },
        targetBranch: { type: 'string', description: '目标分支' },
        title: { type: 'string', description: 'MR 标题' },
      },
      required: ['bugId', 'branchName', 'targetBranch', 'title'],
    },
    internal: true,
  };

  private clients: WorkflowClients;

  constructor(clients: WorkflowClients, logger: Logger) {
    super(logger);
    this.clients = clients;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { bugId, branchName, targetBranch, title } = args as {
      bugId: number;
      branchName: string;
      targetBranch: string;
      title: string;
    };

    const results: { step: string; status: string; message: string }[] = [];

    // 创建分支
    try {
      await this.clients.gitlab.createBranch(branchName, targetBranch);
      results.push({ step: '创建分支', status: 'success', message: `分支 ${branchName} 已创建` });
    } catch (error) {
      results.push({ step: '创建分支', status: 'error', message: (error as Error).message });
    }

    // 创建 MR
    try {
      const mr = await this.clients.gitlab.createMergeRequest(branchName, targetBranch, title, `关联 Bug: #${bugId}`);
      results.push({ step: '创建 MR', status: 'success', message: `MR !${mr.id} 已创建` });
    } catch (error) {
      results.push({ step: '创建 MR', status: 'error', message: (error as Error).message });
    }

    // 更新 Bug
    try {
      await this.clients.zentao.addComment(bugId, `已创建修复分支 ${branchName}`);
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

    return { success: allSuccess, output: { results }, card: card };
  }
}

/** 合并 MR 并关闭 Bug（需审批） */
class MergeAndCloseBugTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'workflow.merge_and_close_bug',
    description: '合并 MR 并关闭关联的禅道 Bug（需要用户审批确认）',
    inputSchema: {
      type: 'object',
      properties: {
        mrId: { type: 'number', description: 'MR ID' },
        bugId: { type: 'number', description: 'Bug ID' },
        comment: { type: 'string', description: '关闭评论（可选）' },
      },
      required: ['mrId', 'bugId'],
    },
    requiresApproval: true,
  };

  private clients: WorkflowClients;

  constructor(clients: WorkflowClients, logger: Logger) {
    super(logger);
    this.clients = clients;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const mrId = args.mrId as number;
    const bugId = args.bugId as number;

    // 获取 MR 和 Bug 信息
    const mrs = await this.clients.gitlab.getMergeRequests('open');
    const mr = mrs.find((m) => m.id === mrId);
    const bug = await this.clients.zentao.getIssue(bugId);

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
}

/** 合并 MR 并关闭 Bug 确认（内部工具） */
class MergeAndCloseBugConfirmTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'workflow.merge_and_close_bug_confirm',
    description: '[内部工具] 确认合并 MR 并关闭 Bug（审批后调用）',
    inputSchema: {
      type: 'object',
      properties: {
        mrId: { type: 'number', description: 'MR ID' },
        bugId: { type: 'number', description: 'Bug ID' },
        comment: { type: 'string', description: '关闭评论' },
      },
      required: ['mrId', 'bugId'],
    },
    internal: true,
  };

  private clients: WorkflowClients;

  constructor(clients: WorkflowClients, logger: Logger) {
    super(logger);
    this.clients = clients;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const mrId = args.mrId as number;
    const bugId = args.bugId as number;
    const comment = (args.comment as string) || `已通过 Merge Request !${mrId} 修复此 Bug`;

    const results: { step: string; status: string; message: string }[] = [];

    // 合并 MR
    try {
      await this.clients.gitlab.mergeMergeRequest(mrId);
      results.push({ step: '合并 MR', status: 'success', message: `MR !${mrId} 已合并` });
    } catch (error) {
      results.push({ step: '合并 MR', status: 'error', message: (error as Error).message });
    }

    // 添加评论
    try {
      await this.clients.zentao.addComment(bugId, comment);
      results.push({ step: '添加评论', status: 'success', message: '评论已添加' });
    } catch (error) {
      results.push({ step: '添加评论', status: 'error', message: (error as Error).message });
    }

    // 关闭 Bug
    try {
      await this.clients.zentao.closeIssue(bugId);
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

    return { success: allSuccess, output: { results }, card: card };
  }
}

// ============================================================
// 工具集工厂
// ============================================================

/**
 * Workflow 工具集
 * 
 * 创建所有工作流相关的独立工具
 */
export async function createWorkflowTools(config: WorkflowToolConfig, logger: Logger): Promise<ITool[]> {
  const gitlab = new GitLabClient({
    apiUrl: config.gitlab.baseUrl,
    token: config.gitlab.token,
    projectId: String(config.gitlab.projectId),
  }, logger);

  const zentao = new ZentaoClient({
    baseUrl: config.zentao.baseUrl,
    token: config.zentao.token,
    account: config.zentao.account,
    password: config.zentao.password,
    projectId: config.zentao.projectId,
  }, logger);

  // 初始化禅道客户端
  await zentao.init();

  const clients: WorkflowClients = { gitlab, zentao };

  return [
    new GetLinkedBugsTool(clients, logger),
    new CreateMRForBugTool(clients, logger),
    new CreateMRForBugConfirmTool(clients, logger),
    new MergeAndCloseBugTool(clients, logger),
    new MergeAndCloseBugConfirmTool(clients, logger),
  ];
}
