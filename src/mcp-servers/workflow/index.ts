/**
 * Workflow MCP Server
 * 
 * 跨 Provider 的工作流编排工具
 * 将 GitLab 和禅道操作组合成原子工作流
 */

import { BaseMCPServer } from '../base';
import { createTool, ToolDefinition } from '../types';
import type { ToolContext } from '../../gateway/types';
import type { Logger } from '../../channels/types';
import { GitLabProvider } from '../../providers/gitlab';
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

export interface WorkflowMCPServerConfig {
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
// Workflow MCP Server 实现
// ============================================================

export class WorkflowMCPServer extends BaseMCPServer {
  readonly name = 'workflow';
  readonly description = '跨平台工作流编排工具（GitLab + 禅道）';

  private gitlabProvider: GitLabProvider;
  private zentaoProvider: ZentaoProvider;

  constructor(config: WorkflowMCPServerConfig, logger: Logger) {
    super(config as unknown as Record<string, unknown>, logger);

    // 初始化 GitLab Provider
    this.gitlabProvider = new GitLabProvider({
      id: 'workflow-gitlab',
      type: 'vcs',
      enabled: true,
      capabilities: ['repository'],
      apiUrl: config.gitlab.baseUrl,
      token: config.gitlab.token,
      projectId: String(config.gitlab.projectId),
    }, logger);

    // 初始化禅道 Provider
    this.zentaoProvider = new ZentaoProvider({
      id: 'workflow-zentao',
      type: 'issue',
      enabled: true,
      capabilities: ['issues', 'project'],
      baseUrl: config.zentao.baseUrl,
      token: config.zentao.token,
      account: config.zentao.account,
      password: config.zentao.password,
      projectId: config.zentao.projectId,
    }, logger);

    this.registerTools(this.createTools());
  }

  // ============================================================
  // 工具定义
  // ============================================================

  private createTools(): ToolDefinition[] {
    return [
      // ========== 合并 MR 并关闭 Bug ==========
      createTool({
        name: 'merge_and_close_bug',
        description: '合并 GitLab MR 并关闭关联的禅道 Bug（需要审批）',
        inputSchema: {
          type: 'object',
          properties: {
            mrId: { type: 'number', description: 'GitLab Merge Request ID (iid)' },
            bugId: { type: 'number', description: '禅道 Bug ID' },
            comment: { type: 'string', description: '关闭 Bug 时添加的评论（可选）' },
          },
          required: ['mrId', 'bugId'],
        },
        requiresApproval: true,
        execute: async (args, context: ToolContext) => {
          const mrId = args.mrId as number;
          const bugId = args.bugId as number;
          const comment = args.comment as string | undefined;

          // 先获取 MR 和 Bug 信息用于审批展示
          let mrInfo: { title: string; url: string; sourceBranch: string } | null = null;
          let bugInfo: { title: string; status: string } | null = null;

          try {
            const mrs = await this.gitlabProvider.getMergeRequests('open');
            const mr = mrs.find(m => m.id === mrId);
            if (mr) {
              mrInfo = { title: mr.title, url: mr.url, sourceBranch: mr.sourceBranch };
            }
          } catch {
            // 忽略错误，继续
          }

          try {
            const bug = await this.zentaoProvider.getIssue(bugId);
            if (bug) {
              bugInfo = { title: bug.title, status: bug.status };
            }
          } catch {
            // 忽略错误，继续
          }

          // 构建卡片内容
          let content = '';
          
          if (mrInfo) {
            content += `### Merge Request !${mrId}\n`;
            content += `**标题**: ${mrInfo.title}\n`;
            content += `**分支**: ${mrInfo.sourceBranch}\n`;
            content += `**链接**: [查看 MR](${mrInfo.url})\n\n`;
          } else {
            content += `### Merge Request !${mrId}\n`;
            content += `*(未找到 MR 信息)*\n\n`;
          }

          if (bugInfo) {
            content += `### 禅道 Bug #${bugId}\n`;
            content += `**标题**: ${bugInfo.title}\n`;
            content += `**状态**: ${bugInfo.status}\n`;
          } else {
            content += `### 禅道 Bug #${bugId}\n`;
            content += `*(未找到 Bug 信息)*\n`;
          }

          if (comment) {
            content += `\n**评论**: ${comment}\n`;
          }

          // 构建飞书原生格式卡片
          const cardContext = buildFeishuCardInteractionContext({
            operatorOpenId: context.userId,
            chatId: context.chatId,
            expiresAt: Date.now() + FEISHU_CARD_DEFAULT_TTL_MS,
          });

          const confirmEnvelope = createFeishuCardInteractionEnvelope({
            kind: 'button',
            action: 'workflow.merge_and_close_bug_confirm',
            args: args as unknown as Record<string, string | number | boolean | null | undefined>,
            context: cardContext,
          });

          const cancelEnvelope = createFeishuCardInteractionEnvelope({
            kind: 'button',
            action: 'workflow.cancel',
            context: cardContext,
          });

          const card = new FeishuCardBuilder()
            .setConfig({ wide_screen_mode: true, update_multi: true }) // 允许卡片更新
            .setHeader('🔄 合并 MR 并关闭 Bug', 'blue')
            .addMarkdown(content)
            .addActionRow(new ActionBuilder()
              .addPrimaryButton('确认执行', confirmEnvelope)
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

      // ========== 确认合并 MR 并关闭 Bug ==========
      createTool({
        name: 'merge_and_close_bug_confirm',
        description: '确认执行：合并 MR 并关闭 Bug（内部工具）',
        internal: true, // 不暴露给 AI
        inputSchema: {
          type: 'object',
          properties: {
            mrId: { type: 'number', description: 'GitLab MR ID' },
            bugId: { type: 'number', description: '禅道 Bug ID' },
            comment: { type: 'string', description: '关闭时的评论' },
          },
          required: ['mrId', 'bugId'],
        },
        execute: async (args) => {
          const mrId = args.mrId as number;
          const bugId = args.bugId as number;
          const comment = args.comment as string | undefined;

          const results: { step: string; status: 'success' | 'error'; message: string }[] = [];

          try {
            // Step 1: 合并 MR
            this.logger?.info(`[Workflow] Merging MR !${mrId}...`);
            const mr = await this.gitlabProvider.mergeMergeRequest(mrId);
            results.push({
              step: '合并 MR',
              status: 'success',
              message: `MR !${mrId} 已合并，标题: ${mr.title}`,
            });
          } catch (error) {
            results.push({
              step: '合并 MR',
              status: 'error',
              message: `合并失败: ${(error as Error).message}`,
            });

            // 返回失败状态卡片
            const errorCard = new FeishuCardBuilder()
              .setConfig({ wide_screen_mode: true, update_multi: true })
              .setHeader('❌ 工作流执行失败', 'red')
              .addMarkdown(`**MR ID**: !${mrId}\n**Bug ID**: #${bugId}\n\n**错误**: MR 合并失败\n\n${results.map(r => `- ${r.step}: ${r.message}`).join('\n')}`)
              .build();

            return {
              success: false,
              output: { results, error: 'MR 合并失败，工作流终止' },
              approvalCard: errorCard,
            };
          }

          try {
            // Step 2: 添加评论
            const commentText = comment || `已通过 Merge Request !${mrId} 修复此 Bug`;
            await this.zentaoProvider.addComment(bugId, commentText);
            results.push({
              step: '添加评论',
              status: 'success',
              message: `已添加评论: "${commentText}"`,
            });
          } catch (error) {
            results.push({
              step: '添加评论',
              status: 'error',
              message: `评论失败: ${(error as Error).message}`,
            });
          }

          try {
            // Step 3: 关闭 Bug
            this.logger?.info(`[Workflow] Closing Bug #${bugId}...`);
            await this.zentaoProvider.closeIssue(bugId);
            results.push({
              step: '关闭 Bug',
              status: 'success',
              message: `Bug #${bugId} 已关闭`,
            });
          } catch (error) {
            results.push({
              step: '关闭 Bug',
              status: 'error',
              message: `关闭失败: ${(error as Error).message}`,
            });
          }

          const allSuccess = results.every(r => r.status === 'success');
          const successCount = results.filter(r => r.status === 'success').length;

          // 构建结果状态卡片
          const resultCard = new FeishuCardBuilder()
            .setConfig({ wide_screen_mode: true, update_multi: true })
            .setHeader(allSuccess ? '✅ 工作流完成' : '⚠️ 工作流部分完成', allSuccess ? 'green' : 'orange')
            .addMarkdown(`**MR ID**: !${mrId}\n**Bug ID**: #${bugId}\n\n**执行结果** (${successCount}/${results.length}):\n\n${results.map(r => `- ${r.status === 'success' ? '✅' : '❌'} ${r.step}: ${r.message}`).join('\n')}`)
            .build();

          return {
            success: allSuccess,
            output: {
              message: allSuccess
                ? `✅ 工作流完成：MR !${mrId} 已合并，Bug #${bugId} 已关闭`
                : `⚠️ 工作流部分完成，请检查结果`,
              results,
              mrId,
              bugId,
            },
            approvalCard: resultCard,
          };
        },
      }),

      // ========== 为 Bug 创建修复 MR ==========
      createTool({
        name: 'create_mr_for_bug',
        description: '为禅道 Bug 创建 GitLab 修复分支和 MR（需要审批）',
        inputSchema: {
          type: 'object',
          properties: {
            bugId: { type: 'number', description: '禅道 Bug ID' },
            branchName: { type: 'string', description: '分支名称（可选，默认 fix/bug-{bugId}）' },
            targetBranch: { type: 'string', description: '目标分支（默认 main）' },
            title: { type: 'string', description: 'MR 标题（可选，默认从 Bug 标题生成）' },
          },
          required: ['bugId'],
        },
        requiresApproval: true,
        execute: async (args, context: ToolContext) => {
          const bugId = args.bugId as number;
          const branchName = args.branchName as string | undefined;
          const targetBranch = (args.targetBranch as string) || 'main';
          const title = args.title as string | undefined;

          // 获取 Bug 信息
          const bug = await this.zentaoProvider.getIssue(bugId);
          if (!bug) {
            return { success: false, error: `Bug #${bugId} 不存在` };
          }

          const actualBranchName = branchName || `fix/bug-${bugId}`;
          const actualTitle = title || `fix: ${bug.title}`;

          const content = `### 禅道 Bug #${bugId}\n`
            + `**标题**: ${bug.title}\n`
            + `**状态**: ${bug.status}\n`
            + `**优先级**: ${bug.priority}\n\n`
            + `### 将创建\n`
            + `**分支**: \`${actualBranchName}\`\n`
            + `**目标**: \`${targetBranch}\`\n`
            + `**MR 标题**: ${actualTitle}`;

          const cardContext = buildFeishuCardInteractionContext({
            operatorOpenId: context.userId,
            chatId: context.chatId,
            expiresAt: Date.now() + FEISHU_CARD_DEFAULT_TTL_MS,
          });

          const confirmArgs = { bugId, branchName: actualBranchName, targetBranch, title: actualTitle };

          const confirmEnvelope = createFeishuCardInteractionEnvelope({
            kind: 'button',
            action: 'workflow.create_mr_for_bug_confirm',
            args: confirmArgs as unknown as Record<string, string | number | boolean | null | undefined>,
            context: cardContext,
          });

          const cancelEnvelope = createFeishuCardInteractionEnvelope({
            kind: 'button',
            action: 'workflow.cancel',
            context: cardContext,
          });

          const card = new FeishuCardBuilder()
            .setConfig({ wide_screen_mode: true, update_multi: true }) // 允许卡片更新
            .setHeader('🔧 为 Bug 创建修复 MR', 'blue')
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
            output: '已发送审批卡片',
            approvalCard: card,
          };
        },
      }),

      // ========== 确认创建修复 MR ==========
      createTool({
        name: 'create_mr_for_bug_confirm',
        description: '确认创建修复 MR（内部工具）',
        internal: true, // 不暴露给 AI
        inputSchema: {
          type: 'object',
          properties: {
            bugId: { type: 'number', description: '禅道 Bug ID' },
            branchName: { type: 'string', description: '分支名称' },
            targetBranch: { type: 'string', description: '目标分支' },
            title: { type: 'string', description: 'MR 标题' },
          },
          required: ['bugId', 'branchName', 'targetBranch', 'title'],
        },
        execute: async (args) => {
          const { bugId, branchName, targetBranch, title } = args as {
            bugId: number;
            branchName: string;
            targetBranch: string;
            title: string;
          };

          const results: { step: string; status: 'success' | 'error'; message: string }[] = [];

          try {
            // Step 1: 创建分支
            this.logger?.info(`[Workflow] Creating branch ${branchName}...`);
            await this.gitlabProvider.createBranch(branchName, targetBranch);
            results.push({
              step: '创建分支',
              status: 'success',
              message: `分支 ${branchName} 已创建`,
            });
          } catch (error) {
            results.push({
              step: '创建分支',
              status: 'error',
              message: `创建失败: ${(error as Error).message}`,
            });

            // 返回失败状态卡片
            const errorCard = new FeishuCardBuilder()
              .setConfig({ wide_screen_mode: true, update_multi: true })
              .setHeader('❌ 创建修复 MR 失败', 'red')
              .addMarkdown(`**Bug ID**: #${bugId}\n**分支**: ${branchName}\n\n**错误**: 分支创建失败\n\n${results.map(r => `- ${r.step}: ${r.message}`).join('\n')}`)
              .build();

            return {
              success: false,
              output: { results, error: '分支创建失败' },
              approvalCard: errorCard,
            };
          }

          try {
            // Step 2: 创建 MR
            this.logger?.info(`[Workflow] Creating MR...`);
            const mr = await this.gitlabProvider.createMergeRequest(
              branchName,
              targetBranch,
              title
            );
            results.push({
              step: '创建 MR',
              status: 'success',
              message: `MR !${mr.id} 已创建: ${mr.url}`,
            });
          } catch (error) {
            results.push({
              step: '创建 MR',
              status: 'error',
              message: `创建失败: ${(error as Error).message}`,
            });
          }

          try {
            // Step 3: 在 Bug 中添加评论记录 MR
            await this.zentaoProvider.addComment(
              bugId,
              `已创建修复分支 ${branchName}，Merge Request: ${title}`
            );
            results.push({
              step: '更新 Bug',
              status: 'success',
              message: `已添加修复记录到 Bug #${bugId}`,
            });
          } catch (error) {
            results.push({
              step: '更新 Bug',
              status: 'error',
              message: `评论失败: ${(error as Error).message}`,
            });
          }

          const allSuccess = results.every(r => r.status === 'success');
          const successCount = results.filter(r => r.status === 'success').length;

          // 构建结果状态卡片
          const resultCard = new FeishuCardBuilder()
            .setConfig({ wide_screen_mode: true, update_multi: true })
            .setHeader(allSuccess ? '✅ 修复 MR 创建成功' : '⚠️ 部分操作失败', allSuccess ? 'green' : 'orange')
            .addMarkdown(`**Bug ID**: #${bugId}\n**分支**: \`${branchName}\`\n**目标**: \`${targetBranch}\`\n**MR 标题**: ${title}\n\n**执行结果** (${successCount}/${results.length}):\n\n${results.map(r => `- ${r.status === 'success' ? '✅' : '❌'} ${r.step}: ${r.message}`).join('\n')}`)
            .build();

          return {
            success: allSuccess,
            output: {
              message: allSuccess
                ? `✅ 已为 Bug #${bugId} 创建修复 MR`
                : `⚠️ 部分操作失败`,
              results,
              branchName,
              bugId,
            },
            approvalCard: resultCard,
          };
        },
      }),

      // ========== 查询 MR 关联的 Bug ==========
      createTool({
        name: 'get_linked_bugs',
        description: '从 MR 描述中提取关联的禅道 Bug ID',
        inputSchema: {
          type: 'object',
          properties: {
            mrId: {
              type: 'number',
              description: 'GitLab Merge Request ID',
            },
          },
          required: ['mrId'],
        },
        execute: async (args) => {
          const mrId = args.mrId as number;

          const mrs = await this.gitlabProvider.getMergeRequests();
          const mr = mrs.find(m => m.id === mrId);

          if (!mr) {
            return { success: false, error: `MR !${mrId} 不存在` };
          }

          // 从 MR 描述中提取 Bug ID
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

          // 获取 Bug 详情
          const bugs = await Promise.all(
            bugIds.map(id => this.zentaoProvider.getIssue(id))
          );

          return {
            success: true,
            output: {
              mr: {
                id: mr.id,
                title: mr.title,
                status: mr.status,
                url: mr.url,
              },
              linkedBugs: bugs.filter(Boolean).map(bug => ({
                id: bug!.id,
                title: bug!.title,
                status: bug!.status,
              })),
              rawBugIds: bugIds,
            },
          };
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
        execute: async (_args, context: ToolContext) => {
          // 发送取消消息给用户
          await context.sendText('❌ 操作已取消');
          
          // 返回更新后的卡片（不带按钮，显示已取消状态）
          const cancelledCard = new FeishuCardBuilder()
            .setConfig({ wide_screen_mode: true, update_multi: true })
            .setHeader('❌ 已取消', 'grey')
            .addMarkdown('操作已被用户取消')
            .build();
          
          return { 
            success: true, 
            output: '操作已取消',
            approvalCard: cancelledCard, // 用于更新原卡片
          };
        },
      }),
    ];
  }

  // ============================================================
  // 生命周期
  // ============================================================

  async start(): Promise<void> {
    await this.gitlabProvider.start();
    await this.zentaoProvider.start();
    await super.start();
    this.logger?.info('[WorkflowMCPServer] Started with GitLab + Zentao providers');
  }

  async stop(): Promise<void> {
    await super.stop();
  }
}

// ============================================================
// 工厂函数
// ============================================================

export function createWorkflowMCPServer(
  config: WorkflowMCPServerConfig,
  logger: Logger
): WorkflowMCPServer {
  return new WorkflowMCPServer(config, logger);
}