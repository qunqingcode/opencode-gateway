/**
 * 代码修改指令处理器
 * 
 * 职责：
 * 1. 从 AI 响应中解析 code_change 请求
 * 2. 构建审批卡片（通过 CardBuilder）
 * 3. 处理用户交互（创建 MR / 打回）
 */

import type {
  Command,
  CommandHandler,
  CommandContext,
  InteractionResult,
  InteractionEnvelope,
  CodeChangePayload,
} from '../types';

// ============================================================
// 类型定义
// ============================================================

/** 代码修改指令 */
export type CodeChangeCommand = Command<CodeChangePayload>;

// ============================================================
// 解析器
// ============================================================

/**
 * 从文本中提取完整的 JSON 对象
 */
function extractCompleteJson(text: string, startIndex: number): string | null {
  if (text[startIndex] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          return text.substring(startIndex, i + 1);
        }
      }
    }
  }

  return null;
}

/**
 * 从文本中解析代码修改请求
 */
function parseCodeChange(text: string): CodeChangeCommand | null {
  // 提取 ```json ... ``` 代码块
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const content = match[1].trim();
    if (!content.startsWith('{')) continue;

    try {
      const parsed = JSON.parse(content);

      if (parsed.action === 'code_change' || (parsed.summary && parsed.files)) {
        const files = Array.isArray(parsed.files)
          ? parsed.files.map(String)
          : typeof parsed.files === 'string'
            ? parsed.files.split(',').map((f: string) => f.trim()).filter(Boolean)
            : [];

        if (files.length === 0) continue;

        return {
          type: 'code_change',
          id: `code_change_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          payload: {
            branchName: (parsed.branchName || parsed.branch || `ai-change-${Date.now()}`) as string,
            summary: parsed.summary as string,
            changelog: parsed.changelog as string | undefined,
            files,
            docUrl: (parsed.docUrl || parsed.doc_url) as string | undefined,
          },
        };
      }
    } catch {
      // 忽略非 JSON 内容
    }
  }

  // 如果没找到代码块，尝试直接提取 JSON
  let startIdx = text.indexOf('{');
  while (startIdx !== -1) {
    const extracted = extractCompleteJson(text, startIdx);
    if (extracted) {
      try {
        const parsed = JSON.parse(extracted);

        if (parsed.action === 'code_change' || (parsed.summary && parsed.files)) {
          const files = Array.isArray(parsed.files)
            ? parsed.files.map(String)
            : typeof parsed.files === 'string'
              ? parsed.files.split(',').map((f: string) => f.trim()).filter(Boolean)
              : [];

          if (files.length > 0) {
            return {
              type: 'code_change',
              id: `code_change_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
              payload: {
                branchName: (parsed.branchName || parsed.branch || `ai-change-${Date.now()}`) as string,
                summary: parsed.summary as string,
                changelog: parsed.changelog as string | undefined,
                files,
                docUrl: (parsed.docUrl || parsed.doc_url) as string | undefined,
              },
            };
          }
        }
      } catch {
        // 忽略非 JSON 内容
      }
      startIdx = text.indexOf('{', startIdx + extracted.length);
    } else {
      startIdx = text.indexOf('{', startIdx + 1);
    }
  }

  return null;
}

// ============================================================
// 卡片构建
// ============================================================

/**
 * 构建代码修改审批卡片
 */
async function buildCodeChangeCard(
  command: CodeChangeCommand,
  context: CommandContext
): Promise<unknown> {
  // 使用 CardBuilder 抽象，不再直接依赖飞书卡片
  return context.cardBuilder.buildCodeChangeCard(command.payload, {
    userId: context.userId,
    chatId: context.chatId,
  });
}

// ============================================================
// 交互处理
// ============================================================

/** 默认目标分支 */
const DEFAULT_TARGET_BRANCH = 'develop';

/**
 * 处理代码修改用户交互
 */
async function handleCodeChangeInteraction(
  action: string,
  envelope: InteractionEnvelope,
  context: CommandContext
): Promise<InteractionResult> {
  const [, actionType] = action.split('.');
  const branchName = (envelope.metadata?.branch as string) || (envelope.value?.branch as string) || '';

  if (actionType === 'create_mr') {
    // 检查是否有 repository 服务
    if (!context.services?.repository) {
      return {
        toast: { type: 'warning', content: 'GitLab 未配置' },
        card: await context.cardBuilder.buildStatusCard({
          title: '⚠️ GitLab 未配置',
          status: 'warning',
          message: '无法自动创建 MR',
          details: `请配置 GitLab 后重试，或手动创建 MR。\n\n分支: \`${branchName}\``,
        }),
      };
    }

    try {
      const sourceBranch = branchName || `ai-change-${Date.now()}`;
      const targetBranch = DEFAULT_TARGET_BRANCH;
      const mr = await context.services.repository.createMergeRequest(
        sourceBranch,
        targetBranch,
        `AI 代码修改: ${sourceBranch}`
      );

      return {
        toast: { type: 'success', content: 'MR 创建成功' },
        card: await context.cardBuilder.buildStatusCard({
          title: '✅ MR 创建成功',
          status: 'success',
          message: '已创建 Merge Request',
          details: `[查看 MR](${mr.url})\n\n分支: \`${sourceBranch}\` → \`${targetBranch}\``,
        }),
      };
    } catch (error) {
      return {
        toast: { type: 'error', content: `创建 MR 失败: ${(error as Error).message}` },
      };
    }
  }

  if (actionType === 'reject') {
    return {
      toast: { type: 'info', content: '已打回' },
      card: await context.cardBuilder.buildStatusCard({
        title: '⚠️ 已打回',
        status: 'warning',
        message: '代码修改已被打回',
        details: branchName ? `分支 \`${branchName}\` 已保留，可手动处理` : '修改已取消',
      }),
    };
  }

  return { toast: { type: 'info', content: '已处理' } };
}

// ============================================================
// 导出 Handler
// ============================================================

/**
 * 代码修改指令处理器
 */
export const codeChangeHandler: CommandHandler<CodeChangePayload> = {
  type: 'code_change',

  parse: parseCodeChange,

  buildCard: buildCodeChangeCard,

  handleInteraction: handleCodeChangeInteraction,
};

export default codeChangeHandler;