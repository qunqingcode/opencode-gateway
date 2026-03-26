/**
 * GitLab MCP Server
 * 
 * 封装 GitLab API 为 MCP 工具
 */

import { BaseMCPServer } from '../base';
import { createTool, ToolDefinition } from '../types';
import type { ToolContext } from '../../gateway/types';
import type { Logger } from '../../channels/types';
import { GitLabClient, GitLabClientConfig } from '../../api/gitlab';
import {
  FeishuCardBuilder,
  ActionBuilder,
  createFeishuCardInteractionEnvelope,
  buildFeishuCardInteractionContext,
  FEISHU_CARD_DEFAULT_TTL_MS,
} from '../../api/feishu/card';

// ============================================================
// 配置
// ============================================================

export interface GitLabMCPServerConfig {
  baseUrl: string;
  token: string;
  projectId: string | number;
}

// ============================================================
// GitLab MCP Server 实现
// ============================================================

export class GitLabMCPServer extends BaseMCPServer {
  readonly name = 'gitlab';
  readonly description = 'GitLab 代码仓库工具';

  private client: GitLabClient;

  constructor(config: GitLabMCPServerConfig, logger: Logger) {
    super(config as unknown as Record<string, unknown>, logger);

    this.client = new GitLabClient({
      apiUrl: config.baseUrl,
      token: config.token,
      projectId: String(config.projectId),
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
        name: 'get_branches',
        description: '获取分支列表',
        inputSchema: {
          type: 'object',
          properties: {
            search: { type: 'string', description: '搜索关键词' },
          },
        },
        execute: async (args) => {
          const branches = await this.client.getBranches?.();
          if (!branches) {
            return { success: false, error: '获取分支列表失败' };
          }
          
          let filtered = branches;
          if (args.search) {
            const search = args.search as string;
            filtered = branches.filter(b => b.name.includes(search));
          }
          
          return { success: true, output: filtered.slice(0, 50) };
        },
      }),

      createTool({
        name: 'get_merge_requests',
        description: '获取 MR 列表',
        inputSchema: {
          type: 'object',
          properties: {
            state: { type: 'string', description: 'MR 状态 (opened, closed, merged)' },
            sourceBranch: { type: 'string', description: '源分支' },
          },
        },
        execute: async (args) => {
          // GitLab Provider 需要实现 getMergeRequests 方法
          // 这里暂时返回模拟数据
          return { 
            success: true, 
            output: { 
              message: 'MR 列表查询功能待实现',
              filters: args,
            },
          };
        },
      }),

      // ========== 创建类工具 (需要审批) ==========
      createTool({
        name: 'create_mr',
        description: '创建 Merge Request (需要审批)',
        inputSchema: {
          type: 'object',
          properties: {
            sourceBranch: { type: 'string', description: '源分支' },
            targetBranch: { type: 'string', description: '目标分支' },
            title: { type: 'string', description: 'MR 标题' },
            description: { type: 'string', description: 'MR 描述' },
            changelogUrl: { type: 'string', description: '变更日志云文档链接' },
          },
          required: ['sourceBranch', 'targetBranch', 'title'],
        },
        requiresApproval: true,
        execute: async (args, context: ToolContext) => {
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
            args: args as unknown as Record<string, string | number | boolean | null | undefined>,
            context: cardContext,
          });

          const cancelEnvelope = createFeishuCardInteractionEnvelope({
            kind: 'button',
            action: 'gitlab.cancel',
            context: cardContext,
          });

          const card = new FeishuCardBuilder()
            .setConfig({ wide_screen_mode: true, update_multi: true }) // 允许卡片更新
            .setHeader('🔀 创建 MR 确认', 'blue')
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

      createTool({
        name: 'create_mr_confirm',
        description: '确认创建 MR (内部工具)',
        internal: true, // 不暴露给 AI
        inputSchema: {
          type: 'object',
          properties: {
            sourceBranch: { type: 'string', description: '源分支' },
            targetBranch: { type: 'string', description: '目标分支' },
            title: { type: 'string', description: 'MR 标题' },
            description: { type: 'string', description: 'MR 描述' },
            changelogUrl: { type: 'string', description: '变更日志链接' },
          },
          required: ['sourceBranch', 'targetBranch', 'title'],
        },
        execute: async (args) => {
          try {
            // 构建 MR 描述，包含变更日志链接
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

            // 返回成功状态卡片
            let successContent = `**标题**: ${args.title}\n**源分支**: \`${args.sourceBranch}\`\n**目标分支**: \`${args.targetBranch}\`\n**链接**: [查看 MR](${mr.url})`;
            if (args.changelogUrl) {
              successContent += `\n\n📄 **变更日志**: [查看](${args.changelogUrl})`;
            }

            const successCard = new FeishuCardBuilder()
              .setConfig({ wide_screen_mode: true, update_multi: true })
              .setHeader('✅ MR 创建成功', 'green')
              .addMarkdown(successContent)
              .build();

            return {
              success: true,
              output: {
                message: `MR 创建成功`,
                url: mr.url,
              },
              approvalCard: successCard,
            };
          } catch (error) {
            // 返回失败状态卡片
            const errorCard = new FeishuCardBuilder()
              .setConfig({ wide_screen_mode: true, update_multi: true })
              .setHeader('❌ MR 创建失败', 'red')
              .addMarkdown(`**错误**: ${(error as Error).message}\n**标题**: ${args.title}\n**源分支**: \`${args.sourceBranch}\`\n**目标分支**: \`${args.targetBranch}\``)
              .build();

            return {
              success: false,
              error: (error as Error).message,
              approvalCard: errorCard,
            };
          }
        },
      }),

      createTool({
        name: 'create_branch',
        description: '创建分支',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '分支名称' },
            ref: { type: 'string', description: '基于哪个分支/commit 创建' },
          },
          required: ['name'],
        },
        execute: async (args) => {
          const branch = await this.client.createBranch?.(
            args.name as string,
            args.ref as string
          );
          if (!branch) {
            return { success: false, error: '创建分支失败' };
          }
          return { success: true, output: { message: `分支 ${branch.name} 创建成功` } };
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
    await super.start();
  }

  async stop(): Promise<void> {
    await super.stop();
  }
}

// ============================================================
// 工厂函数
// ============================================================

export function createGitLabMCPServer(
  config: GitLabMCPServerConfig,
  logger: Logger
): GitLabMCPServer {
  return new GitLabMCPServer(config, logger);
}