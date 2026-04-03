/**
 * 审批控制器
 * 
 * 职责：
 * 1. 拦截工具的审批请求
 * 2. 根据工具类型选择卡片模板
 * 3. 渲染并发送审批卡片
 * 4. 处理用户审批响应
 * 5. 通知 FlowEngine 恢复执行
 */

import type { Logger } from '../types';
import type { ToolResult } from '../tools';
import {
  FeishuCardBuilder,
  ActionBuilder,
  createFeishuCardInteractionEnvelope,
  buildFeishuCardInteractionContext,
} from '../channels/feishu';
import { generateId } from '../utils';

// ============================================================
// 类型定义
// ============================================================

/** 审批请求 */
export interface ApprovalRequest {
  /** 审批 ID */
  approvalId: string;
  /** 工具名称 */
  toolName: string;
  /** 审批数据 */
  approvalData: NonNullable<ToolResult['approvalData']>;
  /** 上下文 */
  context: {
    userId: string;
    chatId: string;
    sessionId: string;
    flowExecutionId?: string;
  };
  /** 回调 */
  onApprove: () => Promise<ToolResult>;
  onReject: () => Promise<ToolResult>;
}

/** 暂停的审批 */
export interface PendingApproval extends ApprovalRequest {
  /** 创建时间 */
  createdAt: number;
  /** 过期时间 */
  expiresAt: number;
}

/** 审批控制器配置 */
export interface ApprovalControllerConfig {
  /** 审批超时时间（毫秒） */
  timeout?: number;
}

// ============================================================
// 审批卡片模板
// ============================================================

/**
 * 审批卡片模板
 * 
 * 根据工具类型生成不同的审批卡片
 */
export class ApprovalCardTemplates {
  /**
   * 创建 MR 审批卡片
   */
  static createMR(data: NonNullable<ToolResult['approvalData']>): unknown {
    const details = data.details || {};
    
    return new FeishuCardBuilder()
      .setConfig({ wide_screen_mode: true, update_multi: true })
      .setHeader('🔀 创建 Merge Request', 'blue')
      .addMarkdown(`
**源分支**: \`${details.sourceBranch || '-'}\`
**目标分支**: \`${details.targetBranch || '-'}\`
**标题**: ${details.title || '-'}

${details.description ? `**描述**: ${details.description}` : ''}
      `.trim())
      .build();
  }

  /**
   * 删除分支审批卡片
   */
  static deleteBranch(data: NonNullable<ToolResult['approvalData']>): unknown {
    const details = data.details || {};
    
    return new FeishuCardBuilder()
      .setConfig({ wide_screen_mode: true, update_multi: true })
      .setHeader('⚠️ 删除分支确认', 'red')
      .addMarkdown(`
**分支名称**: \`${details.branchName || '-'}\`
**最后提交**: ${details.lastCommit || '-'}

⚠️ 此操作不可撤销！
      `.trim())
      .build();
  }

  /**
   * 关闭 Bug 审批卡片
   */
  static closeBug(data: NonNullable<ToolResult['approvalData']>): unknown {
    const details = data.details || {};
    
    return new FeishuCardBuilder()
      .setConfig({ wide_screen_mode: true, update_multi: true })
      .setHeader('🐛 关闭 Bug 确认', 'orange')
      .addMarkdown(`
**Bug ID**: #${details.bugId || '-'}
**标题**: ${details.title || '-'}
**状态**: ${details.status || '-'}

**关闭原因**: ${details.reason || '用户请求关闭'}
      `.trim())
      .build();
  }

  /**
   * 通用审批卡片
   */
  static generic(data: NonNullable<ToolResult['approvalData']>): unknown {
    return new FeishuCardBuilder()
      .setConfig({ wide_screen_mode: true, update_multi: true })
      .setHeader('🔐 操作确认', 'blue')
      .addMarkdown(`
**操作**: ${data.action}
**摘要**: ${data.summary}
      `.trim())
      .build();
  }

  /**
   * 根据工具名称选择模板
   */
  static getTemplate(toolName: string, data: NonNullable<ToolResult['approvalData']>): unknown {
    const templates: Record<string, (data: NonNullable<ToolResult['approvalData']>) => unknown> = {
      'gitlab.create_mr': this.createMR,
      'gitlab.create_merge_request': this.createMR,
      'gitlab.delete_branch': this.deleteBranch,
      'zentao.close_bug': this.closeBug,
    };

    const template = templates[toolName] || this.generic;
    return template(data);
  }
}

// ============================================================
// 审批控制器
// ============================================================

/**
 * 审批控制器
 */
export class ApprovalController {
  private logger: Logger;
  private config: ApprovalControllerConfig;
  
  /** 暂停的审批请求 */
  private pendingApprovals = new Map<string, PendingApproval>();

  constructor(logger: Logger, config?: ApprovalControllerConfig) {
    this.logger = logger;
    this.config = {
      timeout: 600000, // 默认 10 分钟
      ...config,
    };
  }

  // ============================================================
  // 创建审批
  // ============================================================

  /**
   * 创建审批请求
   * 
   * @returns 审批卡片和审批 ID
   */
  async createApproval(request: Omit<ApprovalRequest, 'approvalId'>): Promise<{
    approvalId: string;
    card: unknown;
  }> {
    const approvalId = generateId();

    // 创建审批卡片
    const cardContent = ApprovalCardTemplates.getTemplate(
      request.toolName,
      request.approvalData
    );

    // 添加审批按钮
    const card = this.addApprovalButtons(cardContent, approvalId, request.context);

    // 保存审批请求
    const pendingApproval: PendingApproval = {
      ...request,
      approvalId,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.config.timeout!,
    };

    this.pendingApprovals.set(approvalId, pendingApproval);

    this.logger.info(`[ApprovalController] Created approval: ${approvalId} for ${request.toolName}`);

    return { approvalId, card };
  }

  /**
   * 添加审批按钮
   */
  private addApprovalButtons(card: unknown, approvalId: string, context: ApprovalRequest['context']): unknown {
    const cardContext = buildFeishuCardInteractionContext({
      operatorOpenId: context.userId,
      chatId: context.chatId,
      expiresAt: Date.now() + this.config.timeout!,
    });

    const confirmEnvelope = createFeishuCardInteractionEnvelope({
      kind: 'button',
      action: 'approval.approve',
      args: { approvalId },
      context: cardContext,
    });

    const rejectEnvelope = createFeishuCardInteractionEnvelope({
      kind: 'button',
      action: 'approval.reject',
      args: { approvalId },
      context: cardContext,
    });

    // 给卡片添加按钮（假设 card 已经是构建器或可以修改）
    // 实际实现需要根据卡片结构来添加按钮
    return card;
  }

  // ============================================================
  // 处理审批响应
  // ============================================================

  /**
   * 处理审批确认
   */
  async handleApprove(approvalId: string): Promise<ToolResult> {
    const pending = this.pendingApprovals.get(approvalId);

    if (!pending) {
      return {
        success: false,
        error: '审批请求不存在或已过期',
      };
    }

    if (Date.now() > pending.expiresAt) {
      this.pendingApprovals.delete(approvalId);
      return {
        success: false,
        error: '审批请求已过期',
      };
    }

    this.logger.info(`[ApprovalController] Approved: ${approvalId}`);

    try {
      const result = await pending.onApprove();
      this.pendingApprovals.delete(approvalId);
      return result;
    } catch (error) {
      this.logger.error(`[ApprovalController] Approve failed: ${(error as Error).message}`);
      return {
        success: false,
        error: `审批执行失败: ${(error as Error).message}`,
      };
    }
  }

  /**
   * 处理审批拒绝
   */
  async handleReject(approvalId: string): Promise<ToolResult> {
    const pending = this.pendingApprovals.get(approvalId);

    if (!pending) {
      return {
        success: false,
        error: '审批请求不存在或已过期',
      };
    }

    this.logger.info(`[ApprovalController] Rejected: ${approvalId}`);

    try {
      const result = await pending.onReject();
      this.pendingApprovals.delete(approvalId);
      return result;
    } catch (error) {
      this.pendingApprovals.delete(approvalId);
      return {
        success: false,
        error: `用户已取消`,
      };
    }
  }

  // ============================================================
  // 查询
  // ============================================================

  /**
   * 获取审批请求
   */
  getApproval(approvalId: string): PendingApproval | undefined {
    return this.pendingApprovals.get(approvalId);
  }

  /**
   * 检查审批是否存在
   */
  hasApproval(approvalId: string): boolean {
    return this.pendingApprovals.has(approvalId);
  }

  /**
   * 清理过期审批
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, pending] of this.pendingApprovals) {
      if (now > pending.expiresAt) {
        this.pendingApprovals.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.info(`[ApprovalController] Cleaned ${cleaned} expired approvals`);
    }

    return cleaned;
  }
}