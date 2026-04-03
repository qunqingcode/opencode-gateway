/**
 * GitLab 工具集
 *
 * 每个操作独立成一个工具，符合 MCP 标准风格
 */

import type { Logger } from '../types';
import { BaseTool } from './base';
import type { ToolDefinition, ToolResult, ToolContext, ITool } from './types';
import { GitLabClient } from '../clients/gitlab';
import {
  FeishuCardBuilder,
  ActionBuilder,
  createFeishuCardInteractionEnvelope,
  buildFeishuCardInteractionContext,
  FEISHU_CARD_DEFAULT_TTL_MS,
} from '../channels/feishu';
import { InputValidator } from '../utils/validation';

// ============================================================
// 配置
// ============================================================

export interface GitLabToolConfig {
  baseUrl: string;
  token: string;
  projectId: string | number;
}

// ============================================================
// 工具定义
// ============================================================

/** 获取分支列表 */
class GetBranchesTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'gitlab.get_branches',
    description: '获取 GitLab 分支列表',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: '搜索关键词（可选）' },
      },
      required: [],
    },
  };

  private client: GitLabClient;

  constructor(client: GitLabClient, logger: Logger) {
    super(logger);
    this.client = client;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const branches = await this.client.getBranches();

    let filtered = branches;
    if (args.search) {
      const search = args.search as string;
      InputValidator.validateTextLength(search, 'search', 0, 100);
      filtered = branches.filter((b) => b.name.includes(search));
    }

    return this.success(filtered.slice(0, 50));
  }
}

/** 获取 MR 列表 */
class GetMergeRequestsTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'gitlab.get_merge_requests',
    description: '获取 GitLab Merge Request 列表',
    inputSchema: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          description: 'MR 状态: open, merged, closed',
          enum: ['open', 'merged', 'closed'],
        },
      },
      required: [],
    },
  };

  private client: GitLabClient;

  constructor(client: GitLabClient, logger: Logger) {
    super(logger);
    this.client = client;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const state = args.state as 'open' | 'merged' | 'closed' | undefined;
    const mrs = await this.client.getMergeRequests(state);
    return this.success(mrs);
  }
}

/** 创建 MR（需审批） */
class CreateMRTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'gitlab.create_mr',
    description: '创建 Merge Request（需要用户审批确认）',
    inputSchema: {
      type: 'object',
      properties: {
        sourceBranch: { type: 'string', description: '源分支' },
        targetBranch: { type: 'string', description: '目标分支' },
        title: { type: 'string', description: 'MR 标题' },
        description: { type: 'string', description: 'MR 描述（可选）' },
        changelogUrl: { type: 'string', description: '变更日志链接（可选）' },
      },
      required: ['sourceBranch', 'targetBranch', 'title'],
    },
    requiresApproval: true,
  };

  private client: GitLabClient;

  constructor(client: GitLabClient, logger: Logger) {
    super(logger);
    this.client = client;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    // 验证输入
    const sourceBranch = args.sourceBranch as string;
    const targetBranch = args.targetBranch as string;
    const title = args.title as string;

    InputValidator.validateBranchName(sourceBranch, 'sourceBranch');
    InputValidator.validateBranchName(targetBranch, 'targetBranch');
    InputValidator.validateTextLength(title, 'title', 1, 500);

    if (args.description) {
      InputValidator.validateTextLength(args.description as string, 'description', 0, 10000);
    }

    if (args.changelogUrl) {
      InputValidator.validateUrl(args.changelogUrl as string, 'changelogUrl');
    }

    // 如果已审批，执行业务逻辑
    if (context.approved) {
      this.logger.info(`[CreateMR] Approved, creating MR: ${sourceBranch} → ${targetBranch}`);

      try {
        const mr = await this.client.createMergeRequest(
          sourceBranch,
          targetBranch,
          title,
          args.description as string | undefined
        );

        return this.success({
          url: mr.url,
          id: mr.id,
          title: mr.title,
        });
      } catch (error) {
        return this.error(`创建 MR 失败: ${(error as Error).message}`);
      }
    }

    // 未审批，返回审批数据
    return {
      success: true,
      requiresApproval: true,
      approvalData: {
        action: 'gitlab.create_mr',
        summary: `创建 MR: ${sourceBranch} → ${targetBranch}`,
        details: {
          sourceBranch,
          targetBranch,
          title,
          description: args.description,
          changelogUrl: args.changelogUrl,
        },
      },
    };
  }
}

/** 创建 MR 确认（内部工具） */
class CreateMRConfirmTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'gitlab.create_mr_confirm',
    description: '[内部工具] 确认创建 MR（审批后调用）',
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
    internal: true, // 不暴露给 AI
  };

  private client: GitLabClient;

  constructor(client: GitLabClient, logger: Logger) {
    super(logger);
    this.client = client;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
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

      return {
        success: true,
        output: {
          message: 'MR 创建成功',
          url: mr.url,
          id: mr.id,
          title: mr.title,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `创建 MR 失败: ${(error as Error).message}`,
      };
    }
  }
}

/** 创建分支 */
class CreateBranchTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'gitlab.create_branch',
    description: '创建新分支',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '分支名称' },
        ref: { type: 'string', description: '基于哪个分支创建（默认 main）' },
      },
      required: ['name'],
    },
  };

  private client: GitLabClient;

  constructor(client: GitLabClient, logger: Logger) {
    super(logger);
    this.client = client;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const name = args.name as string;
    const ref = args.ref as string | undefined;

    InputValidator.validateBranchName(name, 'name');

    const branch = await this.client.createBranch(name, ref);
    return this.success({ message: `分支 ${branch.name} 创建成功` });
  }
}

// ============================================================
// 工具集工厂
// ============================================================

/**
 * GitLab 工具集
 * 
 * 创建所有 GitLab 相关的独立工具
 */
export function createGitLabTools(config: GitLabToolConfig, logger: Logger): ITool[] {
  const client = new GitLabClient({
    apiUrl: config.baseUrl,
    token: config.token,
    projectId: String(config.projectId),
  }, logger);

  return [
    new GetBranchesTool(client, logger),
    new GetMergeRequestsTool(client, logger),
    new CreateMRTool(client, logger),
    new CreateMRConfirmTool(client, logger),
    new CreateBranchTool(client, logger),
  ];
}
