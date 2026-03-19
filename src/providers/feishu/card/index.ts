/**
 * 飞书卡片 UX 组件
 * 
 * 提供预定义的卡片模板，用于常见场景
 * 
 * 包含：
 * - 审批卡片
 * - 快速操作启动器
 * - 权限确认卡片
 * - 问题确认卡片
 * - 状态卡片
 * - 代码修改审批卡片
 */

import {
  createFeishuCardInteractionEnvelope,
  buildFeishuCardInteractionContext,
  FEISHU_CARD_DEFAULT_TTL_MS,
  FEISHU_APPROVAL_REQUEST_ACTION,
  FEISHU_APPROVAL_CONFIRM_ACTION,
  FEISHU_APPROVAL_CANCEL_ACTION,
  FEISHU_QUICK_ACTION_HELP,
  FEISHU_QUICK_ACTION_NEW_SESSION,
  FEISHU_QUICK_ACTION_RESET,
} from "./card-interaction.js";
import { FeishuCardBuilder, ActionBuilder, type FeishuCard } from "./card-builder.js";

// ============================================================
// 类型定义
// ============================================================

/** 卡片上下文参数 */
export type CardContextParams = {
  operatorOpenId: string;
  chatId?: string;
  expiresAt?: number;
  chatType?: "p2p" | "group";
  sessionKey?: string;
};

/** 审批卡片参数 */
export type ApprovalCardParams = CardContextParams & {
  command: string;
  prompt: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

/** 权限确认卡片参数 */
export type PermissionCardParams = CardContextParams & {
  permission: {
    id: string;
    type: string;
    title?: string;
    pattern?: string | string[];
    metadata?: {
      path?: string;
      command?: string;
      url?: string;
      query?: string;
    };
  };
};

/** 问题确认卡片参数 */
export type QuestionCardParams = CardContextParams & {
  question: {
    id: string;
    questions: Array<{
      question: string;
      options?: string[];
    }>;
  };
};

/** 代码修改审批卡片参数 */
export type CodeChangeCardParams = CardContextParams & {
  branchName: string;
  summary: string;
  files?: string[];
  changelog?: string;
  docUrl?: string;
};

// ============================================================
// 权限类型标题映射
// ============================================================

const PERMISSION_TITLES: Record<string, string> = {
  edit: "📝 文件编辑请求",
  bash: "⚡ 命令执行请求",
  webfetch: "🌐 网页访问请求",
  websearch: "🔍 网络搜索请求",
  read: "📖 文件读取请求",
  write: "✏️ 文件写入请求",
  external_directory: "📁 外部目录访问",
  doom_loop: "🔄 循环检测警告",
};

// ============================================================
// 卡片模板函数
// ============================================================

/**
 * 创建审批卡片
 * 
 * 用于需要用户确认的操作
 */
export function createApprovalCard(params: ApprovalCardParams): FeishuCard {
  const expiresAt = params.expiresAt ?? Date.now() + FEISHU_CARD_DEFAULT_TTL_MS;
  const context = buildFeishuCardInteractionContext({
    operatorOpenId: params.operatorOpenId,
    chatId: params.chatId,
    expiresAt,
    chatType: params.chatType,
    sessionKey: params.sessionKey,
  });

  const confirmEnvelope = createFeishuCardInteractionEnvelope({
    k: "quick",
    a: FEISHU_APPROVAL_CONFIRM_ACTION,
    q: params.command,
    c: context,
  });

  const cancelEnvelope = createFeishuCardInteractionEnvelope({
    k: "button",
    a: FEISHU_APPROVAL_CANCEL_ACTION,
    c: context,
  });

  const actions = new ActionBuilder()
    .addPrimaryButton(params.confirmLabel ?? "确认", confirmEnvelope)
    .addDangerButton(params.cancelLabel ?? "取消", cancelEnvelope)
    .build();

  return new FeishuCardBuilder()
    .setHeader("Confirm action", "orange")
    .addMarkdown(params.prompt)
    .addActionRow(actions)
    .build();
}

/**
 * 创建快速操作启动器卡片
 * 
 * 提供常用操作的快捷入口
 */
export function createQuickActionLauncherCard(params: CardContextParams): FeishuCard {
  const expiresAt = params.expiresAt ?? Date.now() + FEISHU_CARD_DEFAULT_TTL_MS;
  const context = buildFeishuCardInteractionContext({
    operatorOpenId: params.operatorOpenId,
    chatId: params.chatId,
    expiresAt,
    chatType: params.chatType,
    sessionKey: params.sessionKey,
  });

  const helpEnvelope = createFeishuCardInteractionEnvelope({
    k: "quick",
    a: FEISHU_QUICK_ACTION_HELP,
    q: "/help",
    c: context,
  });

  const newSessionEnvelope = createFeishuCardInteractionEnvelope({
    k: "meta",
    a: FEISHU_APPROVAL_REQUEST_ACTION,
    m: {
      command: "/new",
      prompt: "开始一个新的会话？这将重置当前的聊天上下文。",
    },
    c: context,
  });

  const resetEnvelope = createFeishuCardInteractionEnvelope({
    k: "meta",
    a: FEISHU_APPROVAL_REQUEST_ACTION,
    m: {
      command: "/reset",
      prompt: "立即重置会话？当前活跃的对话状态将被清除。",
    },
    c: context,
  });

  const actions = new ActionBuilder()
    .addDefaultButton("帮助", helpEnvelope)
    .addPrimaryButton("新会话", newSessionEnvelope)
    .addDangerButton("重置", resetEnvelope)
    .build();

  return new FeishuCardBuilder()
    .setHeader("Quick actions", "indigo")
    .addMarkdown("运行常用操作，无需输入原始命令。")
    .addActionRow(actions)
    .build();
}

/**
 * 创建权限确认卡片
 * 
 * 用于请求用户授权敏感操作
 */
export function createPermissionCard(params: PermissionCardParams): FeishuCard {
  const { permission } = params;
  const expiresAt = params.expiresAt ?? Date.now() + FEISHU_CARD_DEFAULT_TTL_MS;
  const context = buildFeishuCardInteractionContext({
    operatorOpenId: params.operatorOpenId,
    chatId: params.chatId,
    expiresAt,
    chatType: params.chatType,
    sessionKey: params.sessionKey,
  });

  const title = PERMISSION_TITLES[permission.type] ?? "🔐 权限确认请求";

  // 构建详情内容
  const detailLines: string[] = [];

  if (permission.pattern) {
    const patterns = Array.isArray(permission.pattern)
      ? permission.pattern
      : [permission.pattern];
    detailLines.push(`**匹配规则**:\n\`\`\`\n${patterns.join("\n")}\n\`\`\``);
  }

  if (permission.metadata) {
    if (permission.metadata.path) {
      detailLines.push(`**路径**: \`${permission.metadata.path}\``);
    }
    if (permission.metadata.command) {
      detailLines.push(`**命令**: \`${permission.metadata.command}\``);
    }
    if (permission.metadata.url) {
      detailLines.push(`**URL**: \`${permission.metadata.url}\``);
    }
    if (permission.metadata.query) {
      detailLines.push(`**查询**: \`${permission.metadata.query}\``);
    }
  }

  const detailContent = detailLines.join("\n\n") || "无详细信息";

  // 创建按钮
  const onceEnvelope = createFeishuCardInteractionEnvelope({
    k: "quick",
    a: `permission.once.${permission.id}`,
    q: "once",
    c: context,
  });

  const alwaysEnvelope = createFeishuCardInteractionEnvelope({
    k: "quick",
    a: `permission.always.${permission.id}`,
    q: "always",
    c: context,
  });

  const rejectEnvelope = createFeishuCardInteractionEnvelope({
    k: "button",
    a: `permission.reject.${permission.id}`,
    q: "reject",
    c: context,
  });

  const actions = new ActionBuilder()
    .addPrimaryButton("✅ 允许一次", onceEnvelope)
    .addPrimaryButton("✅ 总是允许", alwaysEnvelope)
    .addDangerButton("❌ 拒绝", rejectEnvelope)
    .build();

  return new FeishuCardBuilder()
    .setHeader(title, "orange")
    .addMarkdown(detailContent)
    .addActionRow(actions)
    .build();
}

/**
 * 创建问题确认卡片
 * 
 * 用于向用户提问并获取回复
 */
export function createQuestionCard(params: QuestionCardParams): FeishuCard {
  const { question } = params;
  const expiresAt = params.expiresAt ?? Date.now() + FEISHU_CARD_DEFAULT_TTL_MS;
  const context = buildFeishuCardInteractionContext({
    operatorOpenId: params.operatorOpenId,
    chatId: params.chatId,
    expiresAt,
    chatType: params.chatType,
    sessionKey: params.sessionKey,
  });

  // 构建问题内容
  const questionLines: string[] = ["**需要您的回复**"];
  question.questions.forEach((q, idx) => {
    questionLines.push(`${idx + 1}. ${q.question}`);
    if (q.options && q.options.length > 0) {
      q.options.forEach((opt) => {
        questionLines.push(`   - ${opt}`);
      });
    }
  });

  const questionContent = questionLines.join("\n");

  // 为第一个问题的选项创建按钮
  const actions = new ActionBuilder();
  const firstQuestion = question.questions[0];

  if (firstQuestion?.options) {
    firstQuestion.options.slice(0, 4).forEach((opt) => {
      const answerEnvelope = createFeishuCardInteractionEnvelope({
        k: "quick",
        a: `question.answer.${question.id}`,
        q: opt,
        c: context,
      });
      actions.addDefaultButton(opt, answerEnvelope);
    });
  }

  // 添加取消按钮
  const cancelEnvelope = createFeishuCardInteractionEnvelope({
    k: "button",
    a: `question.cancel.${question.id}`,
    c: context,
  });
  actions.addDangerButton("❌ 取消", cancelEnvelope);

  return new FeishuCardBuilder()
    .setHeader("❓ 需要您的回复", "blue")
    .addMarkdown(questionContent)
    .addActionRow(actions.build())
    .build();
}

/**
 * 创建代码修改审批卡片
 * 
 * 用于展示代码修改摘要并请求审批创建 MR
 */
export function createCodeChangeCard(params: CodeChangeCardParams): FeishuCard {
  const expiresAt = params.expiresAt ?? Date.now() + FEISHU_CARD_DEFAULT_TTL_MS;
  const context = buildFeishuCardInteractionContext({
    operatorOpenId: params.operatorOpenId,
    chatId: params.chatId,
    expiresAt,
    chatType: params.chatType,
    sessionKey: params.sessionKey,
  });

  // 构建内容
  let content = `**${params.summary}**\n\n`;
  content += `**分支**: \`${params.branchName}\`\n`;
  
  if (params.files && params.files.length > 0) {
    content += `**修改文件**:\n`;
    params.files.forEach(file => {
      content += `- \`${file}\`\n`;
    });
    content += `\n`;
  }

  if (params.changelog) {
    content += `**修改日志**:\n${params.changelog}\n\n`;
  }
  
  if (params.docUrl) {
    content += `**相关文档**: [查看云文档](${params.docUrl})`;
  }

  // 创建按钮
  const createMREnvelope = createFeishuCardInteractionEnvelope({
    k: "quick",
    a: "code_change.create_mr",
    q: params.branchName,
    m: { branch: params.branchName },
    c: context,
  });

  const rejectEnvelope = createFeishuCardInteractionEnvelope({
    k: "button",
    a: "code_change.reject",
    m: { branch: params.branchName },
    c: context,
  });

  const actions = new ActionBuilder()
    .addPrimaryButton("✅ 创建 MR", createMREnvelope)
    .addDangerButton("❌ 打回", rejectEnvelope)
    .build();

  return new FeishuCardBuilder()
    .setHeader("🛠️ 代码修改完成，请审批", "blue")
    .addMarkdown(content)
    .addActionRow(actions)
    .build();
}

/**
 * 创建状态卡片
 * 
 * 用于展示操作状态或结果
 */
export function createStatusCard(params: {
  title: string;
  status: "success" | "error" | "warning" | "info";
  message: string;
  details?: string;
}): FeishuCard {
  const templateMap: Record<string, "green" | "red" | "orange" | "blue"> = {
    success: "green",
    error: "red",
    warning: "orange",
    info: "blue",
  };

  const iconMap: Record<string, string> = {
    success: "✅",
    error: "❌",
    warning: "⚠️",
    info: "ℹ️",
  };

  let content = `${iconMap[params.status]} ${params.message}`;
  if (params.details) {
    content += `\n\n${params.details}`;
  }

  return new FeishuCardBuilder()
    .setHeader(params.title, templateMap[params.status])
    .addMarkdown(content)
    .build();
}

/**
 * 创建思考中卡片
 * 
 * 用于展示 AI 正在处理的状态
 */
export function createThinkingCard(title?: string): FeishuCard {
  return new FeishuCardBuilder()
    .setHeader(title ?? "🤔 正在思考...", "blue")
    .addMarkdown("⏳ AI 正在处理您的请求，请稍候...")
    .build();
}

// ============================================================
// 导出
// ============================================================

export {
  createFeishuCardInteractionEnvelope,
  buildFeishuCardInteractionContext,
  decodeFeishuCardAction,
  FEISHU_CARD_INTERACTION_VERSION,
  FEISHU_CARD_DEFAULT_TTL_MS,
  FEISHU_APPROVAL_REQUEST_ACTION,
  FEISHU_APPROVAL_CONFIRM_ACTION,
  FEISHU_APPROVAL_CANCEL_ACTION,
  FEISHU_QUICK_ACTION_HELP,
  FEISHU_QUICK_ACTION_NEW_SESSION,
  FEISHU_QUICK_ACTION_RESET,
  type FeishuCardInteractionEnvelope,
  type FeishuCardActionEvent as FeishuCardActionEventType,
  type DecodedFeishuCardAction,
  type FeishuCardInteractionKind,
  type FeishuCardInteractionReason,
} from "./card-interaction.js";

export {
  FeishuCardBuilder,
  ActionBuilder,
  buildFeishuCardButton,
  createTextCard,
  createConfirmCard,
  createListCard,
  type FeishuCard,
  type CardElement,
  type CardAction,
} from "./card-builder.js";

// 卡片动作处理器
export {
  createCardActionHandler,
  type FeishuCardActionEvent,
  type CardActionCallbacks,
  type CardActionResult,
  type ContinueResult,
  type Logger as CardActionLogger,
} from "./action-handler.js";